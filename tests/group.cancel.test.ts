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
import { InvalidGroupStateError } from '../src/classes/errors/group-error';
import { removeAllQueueData, delay } from '../src/utils';

describe('JobGroup - cancellation', () => {
  const redisHost = process.env.REDIS_HOST || 'localhost';
  const prefix = process.env.BULLMQ_TEST_PREFIX || 'bull';

  let connection: IORedis;
  let queue: Queue;
  let queueName: string;
  let compQueueName: string;
  let flowProducer: FlowProducer;
  let queueEvents: QueueEvents;

  beforeAll(async () => {
    connection = new IORedis(redisHost, { maxRetriesPerRequest: null });
  });

  beforeEach(async () => {
    queueName = `test-${v4()}`;
    compQueueName = `${queueName}-compensation`;
    queue = new Queue(queueName, { connection, prefix });
    flowProducer = new FlowProducer({ connection, prefix });
    queueEvents = new QueueEvents(queueName, { connection, prefix });
    await queueEvents.waitUntilReady();
  });

  afterEach(async () => {
    await queue.close();
    await flowProducer.close();
    await queueEvents.close();
    await removeAllQueueData(new IORedis(redisHost), queueName);
    await removeAllQueueData(new IORedis(redisHost), compQueueName);
  });

  afterAll(async () => {
    await connection.quit();
  });

  // VAL-11: Cancel with all jobs waiting → FAILED, no compensation
  it('cancelGroup transitions to FAILED when no jobs have completed', async () => {
    const groupNode = await flowProducer.addGroup({
      name: 'cancel-test',
      jobs: [
        { name: 'job-a', queueName, data: {} },
        { name: 'job-b', queueName, data: {} },
        { name: 'job-c', queueName, data: {} },
      ],
      compensation: {
        'job-a': { name: 'comp-a', data: {} },
      },
    });

    await queue.cancelGroup(groupNode.groupId);

    const state = await queue.getGroupState(groupNode.groupId);
    expect(state!.state).toBe('FAILED');
    expect(state!.cancelledCount).toBe(3);

    // No compensation jobs
    const compJobsCount = await connection.llen(
      `${prefix}:${compQueueName}:wait`,
    );
    expect(compJobsCount).toBe(0);
  });

  // VAL-12: Cancel completed group → InvalidGroupStateError
  it('throws InvalidGroupStateError when cancelling a completed group', async () => {
    const groupNode = await flowProducer.addGroup({
      name: 'cancel-completed-test',
      jobs: [{ name: 'job-a', queueName, data: {} }],
    });

    const completedPromise = new Promise<void>(resolve => {
      queueEvents.on('group:completed' as any, () => resolve());
    });

    const worker = new Worker(queueName, async () => 'done', {
      connection,
      prefix,
    });
    await worker.waitUntilReady();
    await completedPromise;
    await worker.close();

    // Group should be COMPLETED now
    const stateBefore = await queue.getGroupState(groupNode.groupId);
    expect(stateBefore!.state).toBe('COMPLETED');

    await expect(queue.cancelGroup(groupNode.groupId)).rejects.toThrow(
      InvalidGroupStateError,
    );

    // State should remain COMPLETED
    const stateAfter = await queue.getGroupState(groupNode.groupId);
    expect(stateAfter!.state).toBe('COMPLETED');
  }, 30000);

  // VAL-10: Cancel with completed + waiting jobs → compensation triggered
  it('cancelGroup creates compensation for completed jobs and cancels waiting jobs', async () => {
    const groupNode = await flowProducer.addGroup({
      name: 'cancel-with-comp',
      jobs: [
        { name: 'job-a', queueName, data: {} },
        { name: 'job-b', queueName, data: {} },
        { name: 'job-c', queueName, data: {} },
      ],
      compensation: {
        'job-a': { name: 'comp-a', data: { rollback: true } },
      },
    });

    // Process only job-a
    let processedJobA = false;
    const worker = new Worker(
      queueName,
      async job => {
        if (job.name === 'job-a') {
          processedJobA = true;
          return 'done';
        }
        // Hang other jobs
        await delay(10000);
        return 'done';
      },
      { connection, prefix, concurrency: 1 },
    );
    await worker.waitUntilReady();

    // Wait until job-a is processed
    await new Promise<void>(resolve => {
      const interval = setInterval(() => {
        if (processedJobA) {
          clearInterval(interval);
          resolve();
        }
      }, 100);
    });
    await delay(200);

    await worker.close();

    // Now cancel the group
    await queue.cancelGroup(groupNode.groupId);

    const state = await queue.getGroupState(groupNode.groupId);
    expect(state!.state).toBe('COMPENSATING');

    // Should have compensation job
    const compJobsCount = await connection.llen(
      `${prefix}:${compQueueName}:wait`,
    );
    expect(compJobsCount).toBeGreaterThan(0);
  }, 30000);
});
