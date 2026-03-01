import { default as IORedis } from 'ioredis';
import {
  describe,
  beforeEach,
  afterEach,
  beforeAll,
  afterAll,
  it,
  expect,
} from 'vitest';
import { v4 } from 'uuid';
import { FlowProducer, Queue } from '../src/classes';
import { removeAllQueueData } from '../src/utils';

/**
 * Group creation tests (VAL-01, VAL-02, VAL-03, VAL-18)
 */
describe('JobGroup creation', () => {
  const redisHost = process.env.REDIS_HOST || 'localhost';
  const prefix = process.env.BULLMQ_TEST_PREFIX || 'bull';

  let connection: IORedis;
  let queue: Queue;
  let queueName: string;
  let flowProducer: FlowProducer;

  beforeAll(async () => {
    connection = new IORedis(redisHost, { maxRetriesPerRequest: null });
  });

  beforeEach(async () => {
    queueName = `test-${v4()}`;
    queue = new Queue(queueName, { connection, prefix });
    flowProducer = new FlowProducer({ connection, prefix });
  });

  afterEach(async () => {
    await flowProducer.close();
    await queue.close();
    await removeAllQueueData(new IORedis(redisHost), queueName);
  });

  afterAll(async () => {
    await connection.quit();
  });

  // VAL-01: Happy path — addGroup returns GroupNode with groupId and job instances
  it('creates a group and returns a GroupNode with groupId and jobs (VAL-01)', async () => {
    const groupNode = await flowProducer.addGroup({
      name: 'test-group',
      queueName,
      jobs: [
        { name: 'job-a', queueName, data: { value: 1 } },
        { name: 'job-b', queueName, data: { value: 2 } },
        { name: 'job-c', queueName, data: { value: 3 } },
      ],
    });

    expect(groupNode).toBeDefined();
    expect(groupNode.groupId).toBeTruthy();
    expect(groupNode.groupName).toBe('test-group');
    expect(groupNode.jobs).toHaveLength(3);
  });

  // VAL-01: Redis hash exists with state ACTIVE and correct totalJobs
  it('stores group metadata in Redis with state ACTIVE (VAL-01)', async () => {
    const groupNode = await flowProducer.addGroup({
      name: 'order-fulfillment',
      queueName,
      jobs: [
        { name: 'charge-payment', queueName, data: { amount: 100 } },
        { name: 'reserve-inventory', queueName, data: { sku: 'X1' } },
      ],
      compensation: {
        'charge-payment': { name: 'refund-payment', data: { amount: 100 } },
      },
    });

    const groupState = await queue.getGroupState(groupNode.groupId);

    expect(groupState).not.toBeNull();
    expect(groupState!.state).toBe('ACTIVE');
    expect(groupState!.totalJobs).toBe(2);
    expect(groupState!.completedCount).toBe(0);
    expect(groupState!.name).toBe('order-fulfillment');
  });

  // VAL-01: Each job carries opts.group.id matching the groupId
  it('attaches group.id to each job opts (VAL-01)', async () => {
    const groupNode = await flowProducer.addGroup({
      name: 'my-group',
      queueName,
      jobs: [
        { name: 'job-a', queueName, data: {} },
        { name: 'job-b', queueName, data: {} },
      ],
    });

    for (const job of groupNode.jobs) {
      expect(job.opts.group).toBeDefined();
      expect(job.opts.group!.id).toBe(groupNode.groupId);
      expect(job.opts.group!.name).toBe('my-group');
      expect(job.opts.group!.queueName).toBe(queueName);
    }
  });

  // VAL-01: Compensation mapping is stored in group metadata
  it('stores compensation mapping in Redis (VAL-01)', async () => {
    const compensation = {
      'charge-payment': {
        name: 'refund-payment',
        data: { orderId: '123' },
      },
    };

    const groupNode = await flowProducer.addGroup({
      name: 'order',
      queueName,
      jobs: [{ name: 'charge-payment', queueName, data: {} }],
      compensation,
    });

    const client = await connection;
    const raw = await connection.hget(
      `${prefix}:${queueName}:groups:${groupNode.groupId}`,
      'compensation',
    );

    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed['charge-payment']).toBeDefined();
    expect(parsed['charge-payment'].name).toBe('refund-payment');
  });

  // VAL-02: Empty jobs array throws before any Redis write
  it('throws when jobs array is empty (VAL-02)', async () => {
    await expect(
      flowProducer.addGroup({
        name: 'empty-group',
        queueName,
        jobs: [],
      }),
    ).rejects.toThrow('Group must contain at least one job');
  });

  // VAL-03: Mismatched compensation key throws; no Redis keys created
  it('throws when compensation key does not match any job name (VAL-03)', async () => {
    await expect(
      flowProducer.addGroup({
        name: 'bad-comp',
        queueName,
        jobs: [{ name: 'job-a', queueName, data: {} }],
        compensation: {
          'non-existent-job': { name: 'comp-job', data: {} },
        },
      }),
    ).rejects.toThrow('Compensation key "non-existent-job" does not match any job name');
  });

  // VAL-18: Job with opts.parent set throws validation error
  it('throws when a job has opts.parent (cannot belong to both group and flow) (VAL-18)', async () => {
    await expect(
      flowProducer.addGroup({
        name: 'bad-group',
        queueName,
        jobs: [
          {
            name: 'job-a',
            queueName,
            data: {},
            opts: { parent: { id: 'parent-id', queue: 'some-queue' } } as any,
          },
        ],
      }),
    ).rejects.toThrow('A job cannot belong to both a group and a flow');
  });
});
