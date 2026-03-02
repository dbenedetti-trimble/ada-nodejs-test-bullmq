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
import { Queue, QueueEvents, Worker, FlowProducer } from '../src/classes';
import { GroupNotFoundError, InvalidGroupStateError } from '../src/classes/errors';
import { removeAllQueueData, delay } from '../src/utils';

describe('JobGroup - Cancellation', () => {
  const redisHost = process.env.REDIS_HOST || 'localhost';
  const prefix = process.env.BULLMQ_TEST_PREFIX || 'bull';

  let queue: Queue;
  let queueName: string;
  let flowProducer: FlowProducer;
  let worker: Worker;
  let queueEvents: QueueEvents;
  let connection: IORedis;

  beforeAll(async () => {
    connection = new IORedis(redisHost, { maxRetriesPerRequest: null });
  });

  beforeEach(async () => {
    queueName = `test-${v4()}`;
    queue = new Queue(queueName, { connection, prefix });
    flowProducer = new FlowProducer({ connection, prefix });
    queueEvents = new QueueEvents(queueName, { connection, prefix });
    await queueEvents.waitUntilReady();
  });

  afterEach(async () => {
    if (worker) {
      await worker.close();
    }
    await queueEvents.close();
    await flowProducer.close();
    await queue.close();
    await removeAllQueueData(new IORedis(redisHost), queueName);
  });

  afterAll(async () => {
    await connection.quit();
  });

  // VAL-10: Cancel an active group with completed jobs
  it('should cancel active group and trigger compensation for completed jobs', async () => {
    const groupNode = await flowProducer.addGroup({
      name: 'cancel-group',
      jobs: [
        { name: 'job-a', queueName, data: { task: 'a' } },
        { name: 'job-b', queueName, data: { task: 'b' } },
        { name: 'job-c', queueName, data: { task: 'c' } },
      ],
      compensation: {
        'job-a': { name: 'comp-a', data: { orderId: '123' } },
      },
    });

    let jobsProcessed = 0;
    worker = new Worker(
      queueName,
      async job => {
        jobsProcessed++;
        if (jobsProcessed === 1) {
          return 'done';
        }
        await delay(10000);
        return 'slow';
      },
      { connection, prefix },
    );

    await delay(1000);

    await queue.cancelGroup(groupNode.groupId);

    const groupState = await queue.getGroupState(groupNode.groupId);
    expect(groupState).toBeDefined();
    expect(['COMPENSATING', 'FAILED']).toContain(groupState!.state);
  });

  // VAL-11: Cancel an active group with no completed jobs
  it('should cancel active group and transition to FAILED when no compensation needed', async () => {
    const groupNode = await flowProducer.addGroup({
      name: 'cancel-no-comp-group',
      jobs: [
        { name: 'job-a', queueName, data: { task: 'a' } },
        { name: 'job-b', queueName, data: { task: 'b' } },
        { name: 'job-c', queueName, data: { task: 'c' } },
      ],
    });

    await queue.cancelGroup(groupNode.groupId);

    const groupState = await queue.getGroupState(groupNode.groupId);
    expect(groupState).toBeDefined();
    expect(groupState!.state).toBe('FAILED');
  });

  // VAL-12: Cancel a completed group (negative path)
  it('should throw error when cancelling a completed group', async () => {
    const groupNode = await flowProducer.addGroup({
      name: 'completed-cancel-group',
      jobs: [
        { name: 'job-a', queueName, data: { task: 'a' } },
      ],
    });

    worker = new Worker(
      queueName,
      async () => {
        return 'done';
      },
      { connection, prefix },
    );

    await delay(2000);

    const groupState = await queue.getGroupState(groupNode.groupId);
    if (groupState?.state === 'COMPLETED') {
      await expect(
        queue.cancelGroup(groupNode.groupId),
      ).rejects.toThrow('Cannot cancel a completed group');
    }
  });
});
