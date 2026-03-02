import { EventEmitter } from 'events';
import { Redis, ChainableCommander } from 'ioredis';
import { v4 } from 'uuid';
import {
  FlowJob,
  FlowQueuesOpts,
  FlowOpts,
  GroupOptions,
  GroupNode,
  IoredisListener,
  ParentOptions,
  QueueBaseOptions,
  RedisClient,
  Tracer,
  ContextManager,
} from '../interfaces';
import { getParentKey, isRedisInstance, trace } from '../utils';
import { Job } from './job';
import { KeysMap, QueueKeys } from './queue-keys';
import { RedisConnection } from './redis-connection';
import { Scripts } from './scripts';
import { SpanKind, TelemetryAttributes } from '../enums';

export interface AddNodeOpts {
  multi: ChainableCommander;
  node: FlowJob;
  parent?: {
    parentOpts: ParentOptions;
    parentDependenciesKey: string;
  };
  /**
   * Queues options that will be applied in each node depending on queue name presence.
   */
  queuesOpts?: FlowQueuesOpts;
}

export interface AddChildrenOpts {
  multi: ChainableCommander;
  nodes: FlowJob[];
  parent: {
    parentOpts: ParentOptions;
    parentDependenciesKey: string;
  };
  queuesOpts?: FlowQueuesOpts;
}

export interface NodeOpts {
  /**
   * Root job queue name.
   */
  queueName: string;
  /**
   * Prefix included in job key.
   */
  prefix?: string;
  /**
   * Root job id.
   */
  id: string;
  /**
   * Maximum depth or levels to visit in the tree.
   */
  depth?: number;
  /**
   * Maximum quantity of children per type (processed, unprocessed).
   */
  maxChildren?: number;
}

export interface JobNode {
  job: Job;
  children?: JobNode[];
}

export interface FlowProducerListener extends IoredisListener {
  /**
   * Listen to 'error' event.
   *
   * This event is triggered when an error is throw.
   */
  error: (failedReason: Error) => void;
}

/**
 * This class allows to add jobs with dependencies between them in such
 * a way that it is possible to build complex flows.
 * Note: A flow is a tree-like structure of jobs that depend on each other.
 * Whenever the children of a given parent are completed, the parent
 * will be processed, being able to access the children's result data.
 * All Jobs can be in different queues, either children or parents,
 */
export class FlowProducer extends EventEmitter {
  toKey: (name: string, type: string) => string;
  keys: KeysMap;
  closing: Promise<void> | undefined;
  queueKeys: QueueKeys;

  protected connection: RedisConnection;
  protected telemetry: {
    tracer: Tracer | undefined;
    contextManager: ContextManager | undefined;
  };

  constructor(
    public opts: QueueBaseOptions = { connection: {} },
    Connection: typeof RedisConnection = RedisConnection,
  ) {
    super();

    this.opts = {
      prefix: 'bull',
      ...opts,
    };

    this.connection = new Connection(opts.connection, {
      shared: isRedisInstance(opts.connection),
      blocking: false,
      skipVersionCheck: opts.skipVersionCheck,
      skipWaitingForReady: opts.skipWaitingForReady,
    });

    this.connection.on('error', (error: Error) => this.emit('error', error));
    this.connection.on('close', () => {
      if (!this.closing) {
        this.emit('ioredis:close');
      }
    });

    this.queueKeys = new QueueKeys(opts.prefix);

    if (opts?.telemetry) {
      this.telemetry = opts.telemetry;
    }
  }

  emit<U extends keyof FlowProducerListener>(
    event: U,
    ...args: Parameters<FlowProducerListener[U]>
  ): boolean {
    return super.emit(event, ...args);
  }

  off<U extends keyof FlowProducerListener>(
    eventName: U,
    listener: FlowProducerListener[U],
  ): this {
    super.off(eventName, listener);
    return this;
  }

  on<U extends keyof FlowProducerListener>(
    event: U,
    listener: FlowProducerListener[U],
  ): this {
    super.on(event, listener);
    return this;
  }

  once<U extends keyof FlowProducerListener>(
    event: U,
    listener: FlowProducerListener[U],
  ): this {
    super.once(event, listener);
    return this;
  }

  /**
   * Returns a promise that resolves to a redis client. Normally used only by subclasses.
   */
  get client(): Promise<RedisClient> {
    return this.connection.client;
  }

  /**
   * Helper to easily extend Job class calls.
   */
  protected get Job(): typeof Job {
    return Job;
  }

  waitUntilReady(): Promise<RedisClient> {
    return this.client;
  }

  /**
   * Adds a flow.
   *
   * This call would be atomic, either it fails and no jobs will
   * be added to the queues, or it succeeds and all jobs will be added.
   *
   * @param flow - an object with a tree-like structure where children jobs
   * will be processed before their parents.
   * @param opts - options that will be applied to the flow object.
   */
  async add(flow: FlowJob, opts?: FlowOpts): Promise<JobNode> {
    if (this.closing) {
      return;
    }
    const client = await this.connection.client;
    const multi = client.multi();

    const parentOpts = flow?.opts?.parent;
    const parentKey = getParentKey(parentOpts);
    const parentDependenciesKey = parentKey
      ? `${parentKey}:dependencies`
      : undefined;

    return trace<Promise<JobNode>>(
      this.telemetry,
      SpanKind.PRODUCER,
      flow.queueName,
      'addFlow',
      flow.queueName,
      async span => {
        span?.setAttributes({
          [TelemetryAttributes.FlowName]: flow.name,
        });

        const jobsTree = await this.addNode({
          multi,
          node: flow,
          queuesOpts: opts?.queuesOptions,
          parent: {
            parentOpts,
            parentDependenciesKey,
          },
        });

        await multi.exec();

        return jobsTree;
      },
    );
  }

  /**
   * Get a flow.
   *
   * @param opts - an object with options for getting a JobNode.
   */
  async getFlow(opts: NodeOpts): Promise<JobNode> {
    if (this.closing) {
      return;
    }
    const client = await this.connection.client;

    const updatedOpts = Object.assign(
      {
        depth: 10,
        maxChildren: 20,
        prefix: this.opts.prefix,
      },
      opts,
    );
    const jobsTree = this.getNode(client, updatedOpts);

    return jobsTree;
  }

  /**
   * Adds multiple flows.
   *
   * A flow is a tree-like structure of jobs that depend on each other.
   * Whenever the children of a given parent are completed, the parent
   * will be processed, being able to access the children's result data.
   *
   * All Jobs can be in different queues, either children or parents,
   * however this call would be atomic, either it fails and no jobs will
   * be added to the queues, or it succeeds and all jobs will be added.
   *
   * @param flows - an array of objects with a tree-like structure where children jobs
   * will be processed before their parents.
   */
  async addBulk(flows: FlowJob[]): Promise<JobNode[]> {
    if (this.closing) {
      return;
    }
    const client = await this.connection.client;
    const multi = client.multi();

    return trace<Promise<JobNode[]>>(
      this.telemetry,
      SpanKind.PRODUCER,
      '',
      'addBulkFlows',
      '',
      async span => {
        span?.setAttributes({
          [TelemetryAttributes.BulkCount]: flows.length,
          [TelemetryAttributes.BulkNames]: flows
            .map(flow => flow.name)
            .join(','),
        });

        const jobsTrees = await this.addNodes(multi, flows);

        await multi.exec();

        return jobsTrees;
      },
    );
  }

  /**
   * Add a node (job) of a flow to the queue. This method will recursively
   * add all its children as well. Note that a given job can potentially be
   * a parent and a child job at the same time depending on where it is located
   * in the tree hierarchy.
   *
   * @param multi - ioredis ChainableCommander
   * @param node - the node representing a job to be added to some queue
   * @param parent - parent data sent to children to create the "links" to their parent
   * @returns
   */
  protected async addNode({
    multi,
    node,
    parent,
    queuesOpts,
  }: AddNodeOpts): Promise<JobNode> {
    const prefix = node.prefix || this.opts.prefix;
    const queue = this.queueFromNode(node, new QueueKeys(prefix), prefix);
    const queueOpts = queuesOpts && queuesOpts[node.queueName];

    const jobsOpts = queueOpts?.defaultJobOptions ?? {};
    const jobId = node.opts?.jobId || v4();

    return trace<Promise<JobNode>>(
      this.telemetry,
      SpanKind.PRODUCER,
      node.queueName,
      'addNode',
      node.queueName,
      async (span, srcPropagationMedatada) => {
        span?.setAttributes({
          [TelemetryAttributes.JobName]: node.name,
          [TelemetryAttributes.JobId]: jobId,
        });
        const opts = node.opts;
        let telemetry = opts?.telemetry;

        if (srcPropagationMedatada && opts) {
          const omitContext = opts.telemetry?.omitContext;
          const telemetryMetadata =
            opts.telemetry?.metadata ||
            (!omitContext && srcPropagationMedatada);

          if (telemetryMetadata || omitContext) {
            telemetry = {
              metadata: telemetryMetadata,
              omitContext,
            };
          }
        }

        const job = new this.Job(
          queue,
          node.name,
          node.data,
          {
            ...jobsOpts,
            ...opts,
            parent: parent?.parentOpts,
            telemetry,
          },
          jobId,
        );

        const parentKey = getParentKey(parent?.parentOpts);

        if (node.children && node.children.length > 0) {
          // Create the parent job, it will be a job in status "waiting-children".
          const parentId = jobId;
          const queueKeysParent = new QueueKeys(
            node.prefix || this.opts.prefix,
          );

          await job.addJob(<Redis>(multi as unknown), {
            parentDependenciesKey: parent?.parentDependenciesKey,
            addToWaitingChildren: true,
            parentKey,
          });

          const parentDependenciesKey = `${queueKeysParent.toKey(
            node.queueName,
            parentId,
          )}:dependencies`;

          const children = await this.addChildren({
            multi,
            nodes: node.children,
            parent: {
              parentOpts: {
                id: parentId,
                queue: queueKeysParent.getQueueQualifiedName(node.queueName),
              },
              parentDependenciesKey,
            },
            queuesOpts,
          });

          return { job, children };
        } else {
          await job.addJob(<Redis>(multi as unknown), {
            parentDependenciesKey: parent?.parentDependenciesKey,
            parentKey,
          });

          return { job };
        }
      },
    );
  }

  /**
   * Adds nodes (jobs) of multiple flows to the queue. This method will recursively
   * add all its children as well. Note that a given job can potentially be
   * a parent and a child job at the same time depending on where it is located
   * in the tree hierarchy.
   *
   * @param multi - ioredis ChainableCommander
   * @param nodes - the nodes representing jobs to be added to some queue
   * @returns
   */
  protected addNodes(
    multi: ChainableCommander,
    nodes: FlowJob[],
  ): Promise<JobNode[]> {
    return Promise.all(
      nodes.map(node => {
        const parentOpts = node?.opts?.parent;
        const parentKey = getParentKey(parentOpts);
        const parentDependenciesKey = parentKey
          ? `${parentKey}:dependencies`
          : undefined;

        return this.addNode({
          multi,
          node,
          parent: {
            parentOpts,
            parentDependenciesKey,
          },
        });
      }),
    );
  }

  private async getNode(client: RedisClient, node: NodeOpts): Promise<JobNode> {
    const queue = this.queueFromNode(
      node,
      new QueueKeys(node.prefix),
      node.prefix,
    );

    const job = await this.Job.fromId(queue, node.id);

    if (job) {
      const {
        processed = {},
        unprocessed = [],
        failed = [],
        ignored = {},
      } = await job.getDependencies({
        failed: {
          count: node.maxChildren,
        },
        processed: {
          count: node.maxChildren,
        },
        unprocessed: {
          count: node.maxChildren,
        },
        ignored: {
          count: node.maxChildren,
        },
      });
      const processedKeys = Object.keys(processed);
      const ignoredKeys = Object.keys(ignored);

      const childrenCount =
        processedKeys.length +
        unprocessed.length +
        ignoredKeys.length +
        failed.length;
      const newDepth = node.depth - 1;
      if (childrenCount > 0 && newDepth) {
        const children = await this.getChildren(
          client,
          [...processedKeys, ...unprocessed, ...failed, ...ignoredKeys],
          newDepth,
          node.maxChildren,
        );

        return { job, children };
      } else {
        return { job };
      }
    }
  }

  private addChildren({ multi, nodes, parent, queuesOpts }: AddChildrenOpts) {
    return Promise.all(
      nodes.map(node => this.addNode({ multi, node, parent, queuesOpts })),
    );
  }

  private getChildren(
    client: RedisClient,
    childrenKeys: string[],
    depth: number,
    maxChildren: number,
  ) {
    const getChild = (key: string) => {
      const [prefix, queueName, id] = key.split(':');

      return this.getNode(client, {
        id,
        queueName,
        prefix,
        depth,
        maxChildren,
      });
    };

    return Promise.all([...childrenKeys.map(getChild)]);
  }

  /**
   * Helper factory method that creates a queue-like object
   * required to create jobs in any queue.
   *
   * @param node -
   * @param queueKeys -
   * @returns
   */
  private queueFromNode(
    node: Omit<NodeOpts, 'id' | 'depth' | 'maxChildren'>,
    queueKeys: QueueKeys,
    prefix: string,
  ) {
    return {
      client: this.connection.client,
      name: node.queueName,
      keys: queueKeys.getKeys(node.queueName),
      toKey: (type: string) => queueKeys.toKey(node.queueName, type),
      opts: { prefix, connection: {} },
      qualifiedName: queueKeys.getQueueQualifiedName(node.queueName),
      closing: this.closing,
      waitUntilReady: async () => this.connection.client,
      removeListener: this.removeListener.bind(this) as any,
      emit: this.emit.bind(this) as any,
      on: this.on.bind(this) as any,
      redisVersion: this.connection.redisVersion,
      databaseType: this.connection.databaseType,
      trace: async (): Promise<any> => {},
    };
  }

  /**
   * Creates a transactional job group (saga pattern).
   *
   * Atomically creates a group of independent jobs that form a logical transaction.
   * If any job fails after exhausting retries, completed siblings are compensated.
   *
   * @param opts - Group creation options including name, jobs, and optional compensation mappings.
   * @returns A GroupNode containing the group ID and created Job instances.
   */
  async addGroup(opts: GroupOptions): Promise<GroupNode> {
    if (this.closing) {
      return;
    }

    if (!opts.jobs || opts.jobs.length === 0) {
      throw new Error('Group must contain at least one job');
    }

    for (const jobDef of opts.jobs) {
      if (jobDef.opts && (jobDef.opts as any).parent) {
        throw new Error(
          'A job cannot belong to both a group and a flow',
        );
      }
    }

    if (opts.compensation) {
      const jobNames = new Set(opts.jobs.map(j => j.name));
      for (const key of Object.keys(opts.compensation)) {
        if (!jobNames.has(key)) {
          throw new Error(
            `Compensation key '${key}' does not match any job in the group`,
          );
        }
      }
    }

    const client = await this.connection.client;
    const multi = client.multi();

    const groupId = v4();
    const compensationJson = JSON.stringify(opts.compensation || {});

    const createdJobs: { id?: string; name: string; queueName: string }[] = [];
    const jobKeys: string[] = [];

    for (const jobDef of opts.jobs) {
      const prefix = jobDef.prefix || this.opts.prefix;
      const queue = this.queueFromNode(jobDef, new QueueKeys(prefix), prefix);

      const jobId = jobDef.opts?.jobId || v4();

      const job = new this.Job(
        queue,
        jobDef.name,
        jobDef.data,
        {
          ...jobDef.opts,
          group: { id: groupId, name: opts.name },
        },
        jobId,
      );

      await job.addJob(<Redis>(multi as unknown), {});

      const jobKey = `${prefix}:${jobDef.queueName}:${jobId}`;
      jobKeys.push(jobKey);

      createdJobs.push({
        id: jobId,
        name: jobDef.name,
        queueName: jobDef.queueName,
      });
    }

    const anchorQueue = this.queueFromNode(
      opts.jobs[0],
      new QueueKeys(opts.jobs[0].prefix || this.opts.prefix),
      opts.jobs[0].prefix || this.opts.prefix,
    );
    const anchorScripts = new Scripts({
      keys: anchorQueue.keys,
      client: this.connection.client,
      get redisVersion() {
        return '';
      },
      get databaseType() {
        return '' as any;
      },
      toKey: anchorQueue.toKey,
      opts: anchorQueue.opts,
      closing: this.closing,
    });

    await anchorScripts.createGroupCommand(
      multi as any,
      groupId,
      opts.name,
      opts.jobs.length,
      compensationJson,
      jobKeys,
    );

    await multi.exec();

    return {
      groupId,
      jobs: createdJobs,
    };
  }

  /**
   *
   * Closes the connection and returns a promise that resolves when the connection is closed.
   */
  async close(): Promise<void> {
    if (!this.closing) {
      this.closing = this.connection.close();
    }
    await this.closing;
  }

  /**
   *
   * Force disconnects a connection.
   */
  disconnect(): Promise<void> {
    return this.connection.disconnect();
  }
}
