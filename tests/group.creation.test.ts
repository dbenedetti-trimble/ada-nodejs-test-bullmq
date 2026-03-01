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
import { FlowProducer, Queue, Worker, QueueEvents } from '../src/classes';
import { removeAllQueueData } from '../src/utils';

describe('JobGroup - creation', () => {
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
    await queue.close();
    await flowProducer.close();
    await removeAllQueueData(new IORedis(redisHost), queueName);
  });

  afterAll(async () => {
    await connection.quit();
  });

  // VAL-01: Happy path
  it('addGroup returns GroupNode with groupId and Job instances; group hash is ACTIVE', async () => {
    const groupNode = await flowProducer.addGroup({
      name: 'order-fulfillment',
      jobs: [
        { name: 'charge-payment', queueName, data: { amount: 99.99 } },
        { name: 'reserve-inventory', queueName, data: { sku: 'WIDGET-1' } },
        {
          name: 'send-confirmation',
          queueName,
          data: { email: 'user@example.com' },
        },
      ],
      compensation: {
        'charge-payment': { name: 'refund-payment', data: { refund: true } },
      },
    });

    expect(groupNode.groupId).toBeTruthy();
    expect(groupNode.groupName).toBe('order-fulfillment');
    expect(groupNode.jobs).toHaveLength(3);

    // Verify group metadata in Redis
    const state = await queue.getGroupState(groupNode.groupId);
    expect(state).not.toBeNull();
    expect(state!.state).toBe('ACTIVE');
    expect(state!.totalJobs).toBe(3);
    expect(state!.completedCount).toBe(0);
    expect(state!.failedCount).toBe(0);
    expect(state!.cancelledCount).toBe(0);
    expect(state!.name).toBe('order-fulfillment');
    expect(state!.createdAt).toBeGreaterThan(0);
  });

  // VAL-02: Empty jobs array
  it('throws when jobs array is empty without creating Redis keys', async () => {
    await expect(
      flowProducer.addGroup({ name: 'test-group', jobs: [] }),
    ).rejects.toThrow('Group must contain at least one job');

    // No group state should exist
    const keys = await connection.keys(`${prefix}:${queueName}:groups*`);
    expect(keys).toHaveLength(0);
  });

  // VAL-03: Mismatched compensation key
  it('throws when compensation key does not match any job name', async () => {
    await expect(
      flowProducer.addGroup({
        name: 'test-group',
        jobs: [{ name: 'job-a', queueName, data: {} }],
        compensation: {
          'nonexistent-job': { name: 'compensate-a', data: {} },
        },
      }),
    ).rejects.toThrow(
      'Compensation key "nonexistent-job" does not match any job name',
    );

    const keys = await connection.keys(`${prefix}:${queueName}:groups*`);
    expect(keys).toHaveLength(0);
  });

  // VAL-18: Job with opts.parent set
  it('throws when a job has opts.parent set', async () => {
    await expect(
      flowProducer.addGroup({
        name: 'test-group',
        jobs: [
          {
            name: 'job-a',
            queueName,
            data: {},
            opts: { parent: { id: 'parent-id', queue: 'parent-queue' } } as any,
          },
        ],
      }),
    ).rejects.toThrow('A job cannot belong to both a group and a flow');

    const keys = await connection.keys(`${prefix}:${queueName}:groups*`);
    expect(keys).toHaveLength(0);
  });

  // VAL-01 sub-check: all jobs carry opts.group.id
  it('all created jobs carry opts.group.id matching the returned groupId', async () => {
    const groupNode = await flowProducer.addGroup({
      name: 'test-group',
      jobs: [
        { name: 'job-a', queueName, data: {} },
        { name: 'job-b', queueName, data: {} },
      ],
    });

    const { groupId } = groupNode;
    for (const job of groupNode.jobs) {
      expect(job.opts.group).toBeDefined();
      expect(job.opts.group.id).toBe(groupId);
      expect(job.opts.group.name).toBe('test-group');
    }
  });

  // VAL-01 sub-check: compensation stored in Redis
  it('stores compensation mapping in group hash', async () => {
    const groupNode = await flowProducer.addGroup({
      name: 'test-group',
      jobs: [{ name: 'job-a', queueName, data: {} }],
      compensation: {
        'job-a': { name: 'compensate-a', data: { rollback: true } },
      },
    });

    const { groupId } = groupNode;
    const compensationRaw = await connection.hget(
      `${prefix}:${queueName}:groups:${groupId}`,
      'compensation',
    );
    expect(compensationRaw).not.toBeNull();
    const compensation = JSON.parse(compensationRaw!);
    expect(compensation['job-a']).toBeDefined();
    expect(compensation['job-a'].name).toBe('compensate-a');
  });
});
