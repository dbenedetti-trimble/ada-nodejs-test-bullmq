'use strict';
import {
  JobJson,
  MinimalJob,
  ParentKeyOpts,
  RedisClient,
  RetryJobOpts,
  RetryOptions,
  MoveToDelayedOpts,
} from '../../interfaces';
import { RedisJobOptions, JobState, JobProgress } from '../../types';
import { isRedisVersionLowerThan, objectToFlatArray } from '../../utils';
import { ScriptContext, pack, finishedErrors } from './script-utils';

export class JobScripts {
  constructor(private ctx: ScriptContext) {}

  protected addDelayedJobArgs(
    job: JobJson,
    encodedOpts: any,
    args: (string | number | Record<string, any>)[],
  ): (string | Buffer)[] {
    const queueKeys = this.ctx.keys;
    const keys: (string | Buffer)[] = [
      queueKeys.marker,
      queueKeys.meta,
      queueKeys.id,
      queueKeys.delayed,
      queueKeys.completed,
      queueKeys.events,
    ];

    keys.push(pack(args), job.data, encodedOpts);

    return keys;
  }

  protected addDelayedJob(
    client: RedisClient,
    job: JobJson,
    encodedOpts: any,
    args: (string | number | Record<string, any>)[],
  ): Promise<string | number> {
    const argsList = this.addDelayedJobArgs(job, encodedOpts, args);

    return this.ctx.execCommand(client, 'addDelayedJob', argsList);
  }

  protected addPrioritizedJobArgs(
    job: JobJson,
    encodedOpts: any,
    args: (string | number | Record<string, any>)[],
  ): (string | Buffer)[] {
    const queueKeys = this.ctx.keys;
    const keys: (string | Buffer)[] = [
      queueKeys.marker,
      queueKeys.meta,
      queueKeys.id,
      queueKeys.prioritized,
      queueKeys.delayed,
      queueKeys.completed,
      queueKeys.active,
      queueKeys.events,
      queueKeys.pc,
    ];

    keys.push(pack(args), job.data, encodedOpts);

    return keys;
  }

  protected addPrioritizedJob(
    client: RedisClient,
    job: JobJson,
    encodedOpts: any,
    args: (string | number | Record<string, any>)[],
  ): Promise<string | number> {
    const argsList = this.addPrioritizedJobArgs(job, encodedOpts, args);

    return this.ctx.execCommand(client, 'addPrioritizedJob', argsList);
  }

  protected addParentJobArgs(
    job: JobJson,
    encodedOpts: any,
    args: (string | number | Record<string, any>)[],
  ): (string | Buffer)[] {
    const queueKeys = this.ctx.keys;
    const keys: (string | Buffer)[] = [
      queueKeys.meta,
      queueKeys.id,
      queueKeys.delayed,
      queueKeys['waiting-children'],
      queueKeys.completed,
      queueKeys.events,
    ];

    keys.push(pack(args), job.data, encodedOpts);

    return keys;
  }

  protected addParentJob(
    client: RedisClient,
    job: JobJson,
    encodedOpts: any,
    args: (string | number | Record<string, any>)[],
  ): Promise<string | number> {
    const argsList = this.addParentJobArgs(job, encodedOpts, args);

    return this.ctx.execCommand(client, 'addParentJob', argsList);
  }

  protected addStandardJobArgs(
    job: JobJson,
    encodedOpts: any,
    args: (string | number | Record<string, any>)[],
  ): (string | Buffer)[] {
    const queueKeys = this.ctx.keys;
    const keys: (string | Buffer)[] = [
      queueKeys.wait,
      queueKeys.paused,
      queueKeys.meta,
      queueKeys.id,
      queueKeys.completed,
      queueKeys.delayed,
      queueKeys.active,
      queueKeys.events,
      queueKeys.marker,
    ];

    keys.push(pack(args), job.data, encodedOpts);

    return keys;
  }

  protected addStandardJob(
    client: RedisClient,
    job: JobJson,
    encodedOpts: any,
    args: (string | number | Record<string, any>)[],
  ): Promise<string | number> {
    const argsList = this.addStandardJobArgs(job, encodedOpts, args);

    return this.ctx.execCommand(client, 'addStandardJob', argsList);
  }

  async addJob(
    client: RedisClient,
    job: JobJson,
    opts: RedisJobOptions,
    jobId: string,
    parentKeyOpts: ParentKeyOpts = {},
  ): Promise<string> {
    const queueKeys = this.ctx.keys;

    const parent: Record<string, any> = job.parent;

    const args = [
      queueKeys[''],
      typeof jobId !== 'undefined' ? jobId : '',
      job.name,
      job.timestamp,
      job.parentKey || null,
      parentKeyOpts.parentDependenciesKey || null,
      parent,
      job.repeatJobKey,
      job.deduplicationId ? `${queueKeys.de}:${job.deduplicationId}` : null,
    ];

    let encodedOpts;
    if (opts.repeat) {
      const repeat = {
        ...opts.repeat,
      };

      if (repeat.startDate) {
        repeat.startDate = +new Date(repeat.startDate);
      }
      if (repeat.endDate) {
        repeat.endDate = +new Date(repeat.endDate);
      }

      encodedOpts = pack({
        ...opts,
        repeat,
      });
    } else {
      encodedOpts = pack(opts);
    }

    let result: string | number;

    if (parentKeyOpts.addToWaitingChildren) {
      result = await this.addParentJob(client, job, encodedOpts, args);
    } else if (typeof opts.delay == 'number' && opts.delay > 0) {
      result = await this.addDelayedJob(client, job, encodedOpts, args);
    } else if (opts.priority) {
      result = await this.addPrioritizedJob(client, job, encodedOpts, args);
    } else {
      result = await this.addStandardJob(client, job, encodedOpts, args);
    }

    if (<number>result < 0) {
      throw finishedErrors({
        code: <number>result,
        parentKey: parentKeyOpts.parentKey,
        command: 'addJob',
      });
    }

    return <string>result;
  }

  protected removeArgs(
    jobId: string,
    removeChildren: boolean,
  ): (string | number)[] {
    const keys: (string | number)[] = [jobId, 'repeat'].map(name =>
      this.ctx.toKey(name),
    );

    const args = [jobId, removeChildren ? 1 : 0, this.ctx.toKey('')];

    return keys.concat(args);
  }

  async remove(jobId: string, removeChildren: boolean): Promise<number> {
    const client = await this.ctx.client;

    const args = this.removeArgs(jobId, removeChildren);
    const result = await this.ctx.execCommand(client, 'removeJob', args);

    if (result < 0) {
      throw finishedErrors({
        code: result,
        jobId,
        command: 'removeJob',
      });
    }

    return result;
  }

  async removeUnprocessedChildren(jobId: string): Promise<void> {
    const client = await this.ctx.client;

    const args = [
      this.ctx.toKey(jobId),
      this.ctx.keys.meta,
      this.ctx.toKey(''),
      jobId,
    ];

    await this.ctx.execCommand(client, 'removeUnprocessedChildren', args);
  }

  async updateData<T = any, R = any, N extends string = string>(
    job: MinimalJob<T, R, N>,
    data: T,
  ): Promise<void> {
    const client = await this.ctx.client;

    const keys = [this.ctx.toKey(job.id)];
    const dataJson = JSON.stringify(data);

    const result = await this.ctx.execCommand(
      client,
      'updateData',
      keys.concat([dataJson]),
    );

    if (result < 0) {
      throw finishedErrors({
        code: result,
        jobId: job.id,
        command: 'updateData',
      });
    }
  }

  async updateProgress(jobId: string, progress: JobProgress): Promise<void> {
    const client = await this.ctx.client;

    const keys = [
      this.ctx.toKey(jobId),
      this.ctx.keys.events,
      this.ctx.keys.meta,
    ];
    const progressJson = JSON.stringify(progress);

    const result = await this.ctx.execCommand(
      client,
      'updateProgress',
      keys.concat([jobId, progressJson]),
    );

    if (result < 0) {
      throw finishedErrors({
        code: result,
        jobId,
        command: 'updateProgress',
      });
    }
  }

  async addLog(
    jobId: string,
    logRow: string,
    keepLogs?: number,
  ): Promise<number> {
    const client = await this.ctx.client;

    const keys: (string | number)[] = [
      this.ctx.toKey(jobId),
      this.ctx.toKey(jobId) + ':logs',
    ];

    const result = await this.ctx.execCommand(
      client,
      'addLog',
      keys.concat([jobId, logRow, keepLogs ? keepLogs : '']),
    );

    if (result < 0) {
      throw finishedErrors({
        code: result,
        jobId,
        command: 'addLog',
      });
    }

    return result;
  }

  async isFinished(
    jobId: string,
    returnValue = false,
  ): Promise<number | [number, string]> {
    const client = await this.ctx.client;

    const keys = ['completed', 'failed', jobId].map((key: string) => {
      return this.ctx.toKey(key);
    });

    return this.ctx.execCommand(
      client,
      'isFinished',
      keys.concat([jobId, returnValue ? '1' : '']),
    );
  }

  async getState(jobId: string): Promise<JobState | 'unknown'> {
    const client = await this.ctx.client;

    const keys = [
      'completed',
      'failed',
      'delayed',
      'active',
      'wait',
      'paused',
      'waiting-children',
      'prioritized',
    ].map((key: string) => {
      return this.ctx.toKey(key);
    });

    if (
      isRedisVersionLowerThan(
        this.ctx.redisVersion,
        '6.0.6',
        this.ctx.databaseType,
      )
    ) {
      return this.ctx.execCommand(client, 'getState', keys.concat([jobId]));
    }
    return this.ctx.execCommand(client, 'getStateV2', keys.concat([jobId]));
  }

  async changeDelay(jobId: string, delay: number): Promise<void> {
    const client = await this.ctx.client;

    const args = this.changeDelayArgs(jobId, delay);
    const result = await this.ctx.execCommand(client, 'changeDelay', args);
    if (result < 0) {
      throw finishedErrors({
        code: result,
        jobId,
        command: 'changeDelay',
        state: 'delayed',
      });
    }
  }

  private changeDelayArgs(jobId: string, delay: number): (string | number)[] {
    const timestamp = Date.now();

    const keys: (string | number)[] = [
      this.ctx.keys.delayed,
      this.ctx.keys.meta,
      this.ctx.keys.marker,
      this.ctx.keys.events,
    ];

    return keys.concat([
      delay,
      JSON.stringify(timestamp),
      jobId,
      this.ctx.toKey(jobId),
    ]);
  }

  async changePriority(
    jobId: string,
    priority = 0,
    lifo = false,
  ): Promise<void> {
    const client = await this.ctx.client;

    const args = this.changePriorityArgs(jobId, priority, lifo);

    const result = await this.ctx.execCommand(client, 'changePriority', args);
    if (result < 0) {
      throw finishedErrors({
        code: result,
        jobId,
        command: 'changePriority',
      });
    }
  }

  changePriorityArgs(
    jobId: string,
    priority = 0,
    lifo = false,
  ): (string | number)[] {
    const keys: (string | number)[] = [
      this.ctx.keys.wait,
      this.ctx.keys.paused,
      this.ctx.keys.meta,
      this.ctx.keys.prioritized,
      this.ctx.keys.active,
      this.ctx.keys.pc,
      this.ctx.keys.marker,
    ];

    return keys.concat([priority, this.ctx.toKey(''), jobId, lifo ? 1 : 0]);
  }

  retryJobArgs(
    jobId: string,
    lifo: boolean,
    token: string,
    opts: MoveToDelayedOpts = {},
  ): (string | number | Buffer)[] {
    const keys: (string | number | Buffer)[] = [
      this.ctx.keys.active,
      this.ctx.keys.wait,
      this.ctx.keys.paused,
      this.ctx.toKey(jobId),
      this.ctx.keys.meta,
      this.ctx.keys.events,
      this.ctx.keys.delayed,
      this.ctx.keys.prioritized,
      this.ctx.keys.pc,
      this.ctx.keys.marker,
      this.ctx.keys.stalled,
    ];

    const pushCmd = (lifo ? 'R' : 'L') + 'PUSH';

    return keys.concat([
      this.ctx.toKey(''),
      Date.now(),
      pushCmd,
      jobId,
      token,
      opts.fieldsToUpdate
        ? pack(objectToFlatArray(opts.fieldsToUpdate))
        : void 0,
    ]);
  }

  async retryJob(
    jobId: string,
    lifo: boolean,
    token = '0',
    opts: RetryJobOpts = {},
  ): Promise<void> {
    const client = await this.ctx.client;

    const args = this.retryJobArgs(jobId, lifo, token, opts);
    const result = await this.ctx.execCommand(client, 'retryJob', args);
    if (result < 0) {
      throw finishedErrors({
        code: result,
        jobId,
        command: 'retryJob',
        state: 'active',
      });
    }
  }

  async reprocessJob<T = any, R = any, N extends string = string>(
    job: MinimalJob<T, R, N>,
    state: 'failed' | 'completed',
    opts: RetryOptions = {},
  ): Promise<void> {
    const client = await this.ctx.client;

    const keys = [
      this.ctx.toKey(job.id),
      this.ctx.keys.events,
      this.ctx.toKey(state),
      this.ctx.keys.wait,
      this.ctx.keys.meta,
      this.ctx.keys.paused,
      this.ctx.keys.active,
      this.ctx.keys.marker,
    ];

    const args = [
      job.id,
      (job.opts.lifo ? 'R' : 'L') + 'PUSH',
      state === 'failed' ? 'failedReason' : 'returnvalue',
      state,
      opts.resetAttemptsMade ? '1' : '0',
      opts.resetAttemptsStarted ? '1' : '0',
    ];

    const result = await this.ctx.execCommand(
      client,
      'reprocessJob',
      keys.concat(args),
    );

    switch (result) {
      case 1:
        return;
      default:
        throw finishedErrors({
          code: result,
          jobId: job.id,
          command: 'reprocessJob',
          state,
        });
    }
  }

  async promote(jobId: string): Promise<void> {
    const client = await this.ctx.client;

    const keys = [
      this.ctx.keys.delayed,
      this.ctx.keys.wait,
      this.ctx.keys.paused,
      this.ctx.keys.meta,
      this.ctx.keys.prioritized,
      this.ctx.keys.active,
      this.ctx.keys.pc,
      this.ctx.keys.events,
      this.ctx.keys.marker,
    ];

    const args = [this.ctx.toKey(''), jobId];

    const code = await this.ctx.execCommand(
      client,
      'promote',
      keys.concat(args),
    );
    if (code < 0) {
      throw finishedErrors({
        code,
        jobId,
        command: 'promote',
        state: 'delayed',
      });
    }
  }

  async removeDeduplicationKey(
    deduplicationId: string,
    jobId: string,
  ): Promise<number> {
    const client = await this.ctx.client;
    const queueKeys = this.ctx.keys;

    const keys: string[] = [`${queueKeys.de}:${deduplicationId}`];

    const args = [jobId];

    return this.ctx.execCommand(
      client,
      'removeDeduplicationKey',
      keys.concat(args),
    );
  }
}
