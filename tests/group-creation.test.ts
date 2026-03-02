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
import { Queue, FlowProducer } from '../src/classes';
import { removeAllQueueData } from '../src/utils';

describe('JobGroup - Creation', () => {
  const redisHost = process.env.REDIS_HOST || 'localhost';
  const prefix = process.env.BULLMQ_TEST_PREFIX || 'bull';

  let queue: Queue;
  let queueName: string;
  let flowProducer: FlowProducer;
  let connection: IORedis;

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

  // VAL-01: Create a job group (happy path)
  it('should create a group with multiple jobs atomically', async () => {
    const groupNode = await flowProducer.addGroup({
      name: 'order-fulfillment',
      jobs: [
        {
          name: 'charge-payment',
          queueName,
          data: { orderId: '123', amount: 99.99 },
        },
        {
          name: 'reserve-inventory',
          queueName,
          data: { orderId: '123', sku: 'WIDGET-1', qty: 2 },
        },
        {
          name: 'send-confirmation',
          queueName,
          data: { orderId: '123', email: 'user@example.com' },
        },
      ],
      compensation: {
        'charge-payment': {
          name: 'refund-payment',
          data: { orderId: '123' },
        },
        'reserve-inventory': {
          name: 'release-inventory',
          data: { orderId: '123', sku: 'WIDGET-1', qty: 2 },
        },
      },
    });

    expect(groupNode).toBeDefined();
    expect(groupNode.groupId).toBeDefined();
    expect(groupNode.jobs).toHaveLength(3);

    for (const job of groupNode.jobs) {
      expect(job.id).toBeDefined();
      expect(job.queueName).toBe(queueName);
    }

    const groupState = await queue.getGroupState(groupNode.groupId);
    expect(groupState).toBeDefined();
    expect(groupState!.state).toBe('ACTIVE');
    expect(groupState!.totalJobs).toBe(3);
    expect(groupState!.completedCount).toBe(0);
    expect(groupState!.failedCount).toBe(0);
    expect(groupState!.name).toBe('order-fulfillment');
  });

  // VAL-02: Create a group with empty jobs array (negative path)
  it('should throw error when creating group with empty jobs', async () => {
    await expect(
      flowProducer.addGroup({
        name: 'empty-group',
        jobs: [],
      }),
    ).rejects.toThrow('Group must contain at least one job');
  });

  // VAL-03: Create a group with mismatched compensation keys (negative path)
  it('should throw error when compensation key does not match any job', async () => {
    await expect(
      flowProducer.addGroup({
        name: 'mismatched-group',
        jobs: [
          { name: 'job-a', queueName, data: {} },
        ],
        compensation: {
          'nonexistent-job': {
            name: 'compensate-nonexistent',
            data: {},
          },
        },
      }),
    ).rejects.toThrow(
      "Compensation key 'nonexistent-job' does not match any job in the group",
    );
  });

  // VAL-18: Job cannot belong to both a group and a flow
  it('should throw error when job has opts.parent set', async () => {
    await expect(
      flowProducer.addGroup({
        name: 'group-with-parent',
        jobs: [
          {
            name: 'job-with-parent',
            queueName,
            data: {},
            opts: {
              parent: { id: 'parent-id', queue: `${prefix}:${queueName}` },
            } as any,
          },
        ],
      }),
    ).rejects.toThrow('A job cannot belong to both a group and a flow');
  });
});
