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
import { removeAllQueueData, delay } from '../src/utils';

describe('JobGroup - Completion', () => {
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

  // VAL-04: Group completes when all jobs succeed
  it('should transition to COMPLETED when all jobs succeed', async () => {
    const groupNode = await flowProducer.addGroup({
      name: 'test-group',
      jobs: [
        { name: 'job-a', queueName, data: { task: 'a' } },
        { name: 'job-b', queueName, data: { task: 'b' } },
        { name: 'job-c', queueName, data: { task: 'c' } },
      ],
    });

    const completedEvent = new Promise<{ groupId: string; groupName: string }>(
      resolve => {
        queueEvents.on('group:completed', args => {
          resolve(args);
        });
      },
    );

    worker = new Worker(
      queueName,
      async job => {
        return `done-${job.data.task}`;
      },
      { connection, prefix },
    );

    const result = await completedEvent;
    expect(result.groupId).toBe(groupNode.groupId);
    expect(result.groupName).toBe('test-group');

    await delay(100);

    const groupState = await queue.getGroupState(groupNode.groupId);
    expect(groupState!.state).toBe('COMPLETED');
    expect(groupState!.completedCount).toBe(3);
  });

  // VAL-05: Group completes with concurrent workers
  it('should handle concurrent worker completion correctly', async () => {
    const groupNode = await flowProducer.addGroup({
      name: 'concurrent-group',
      jobs: [
        { name: 'job-a', queueName, data: { task: 'a' } },
        { name: 'job-b', queueName, data: { task: 'b' } },
        { name: 'job-c', queueName, data: { task: 'c' } },
      ],
    });

    let completedCount = 0;
    queueEvents.on('group:completed', () => {
      completedCount++;
    });

    worker = new Worker(
      queueName,
      async () => {
        return 'ok';
      },
      { connection, prefix, concurrency: 3 },
    );

    await delay(2000);

    const groupState = await queue.getGroupState(groupNode.groupId);
    expect(groupState!.state).toBe('COMPLETED');
    expect(completedCount).toBe(1);
  });
});
