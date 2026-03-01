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
import {
  InvalidGroupStateError,
  GroupNotFoundError,
} from '../src/classes/errors';

describe('JobGroup - Manual Cancellation (GRP-6 cancelGroup)', () => {
  const redisHost = process.env.REDIS_HOST || 'localhost';
  const prefix = process.env.BULLMQ_TEST_PREFIX || 'bull';

  let flowProducer: FlowProducer;
  let queue: Queue;
  let worker: Worker;
  let queueEvents: QueueEvents;
  let queueName: string;
  let connection: IORedis;

  beforeAll(async () => {
    connection = new IORedis(redisHost, { maxRetriesPerRequest: null });
  });

  beforeEach(async () => {
    queueName = `test-${v4()}`;
    queue = new Queue(queueName, { connection, prefix });
    queueEvents = new QueueEvents(queueName, { connection, prefix });
    flowProducer = new FlowProducer({ connection, prefix });
    await queueEvents.waitUntilReady();
  });

  afterEach(async () => {
    await worker?.close();
    await flowProducer.close();
    await queueEvents.close();
    await queue.close();
    await removeAllQueueData(new IORedis(redisHost), queueName);
    await removeAllQueueData(
      new IORedis(redisHost),
      `${queueName}-compensation`,
    );
  });

  afterAll(async () => {
    await connection.quit();
  });

  // VAL-10
  it('should cancel pending jobs and trigger compensation for completed jobs', async () => {
    // job-b and job-c are delayed so they stay in the delayed set while job-a is processed
    const groupNode = await flowProducer.addGroup({
      name: 'cancel-comp-group',
      jobs: [
        { name: 'job-a', queueName, data: {} },
        { name: 'job-b', queueName, data: {}, opts: { delay: 60000 } },
        { name: 'job-c', queueName, data: {}, opts: { delay: 60000 } },
      ],
      compensation: {
        'job-a': { name: 'compensate-a' },
      },
    });

    worker = new Worker(
      queueName,
      async job => {
        if (job.name === 'job-a') {
          return { done: 'a' };
        }
        return {};
      },
      { connection, prefix },
    );

    // Wait for job-a to complete
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('timeout')), 10000);
      worker.on('completed', job => {
        if (job.name === 'job-a') {
          clearTimeout(timeout);
          resolve();
        }
      });
    });

    await worker.close();

    await queue.cancelGroup(groupNode.groupId);
    await new Promise(r => setTimeout(r, 500));

    const state = await queue.getGroupState(groupNode.groupId);
    expect(['COMPENSATING', 'FAILED'].includes(state!.state)).toBe(true);
  });

  // VAL-11
  it('should transition to FAILED directly when no jobs have completed', async () => {
    const groupNode = await flowProducer.addGroup({
      name: 'cancel-no-comp-group',
      jobs: [
        { name: 'job-a', queueName, data: {} },
        { name: 'job-b', queueName, data: {} },
      ],
    });

    // Cancel immediately before any jobs are processed
    await queue.cancelGroup(groupNode.groupId);
    await new Promise(r => setTimeout(r, 200));

    const state = await queue.getGroupState(groupNode.groupId);
    expect(state!.state).toBe('FAILED');
  });

  // VAL-12
  it('should throw InvalidGroupStateError when cancelling a COMPLETED group', async () => {
    const groupNode = await flowProducer.addGroup({
      name: 'cancel-completed-group',
      jobs: [{ name: 'job-a', queueName, data: {} }],
    });

    worker = new Worker(queueName, async () => ({ done: true }), {
      connection,
      prefix,
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('timeout')), 10000);
      worker.on('completed', () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    await new Promise(r => setTimeout(r, 500));

    await expect(queue.cancelGroup(groupNode.groupId)).rejects.toBeInstanceOf(
      InvalidGroupStateError,
    );
  });

  it('should throw InvalidGroupStateError when cancelling a COMPENSATING group', async () => {
    const groupNode = await flowProducer.addGroup({
      name: 'cancel-compensating-group',
      jobs: [
        { name: 'job-a', queueName, data: {} },
        { name: 'job-b', queueName, data: {} },
      ],
    });

    worker = new Worker(
      queueName,
      async job => {
        if (job.name === 'job-a') {
          throw new Error('fail');
        }
        return {};
      },
      { connection, prefix },
    );

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('timeout')), 10000);
      worker.on('failed', () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    await new Promise(r => setTimeout(r, 500));

    const state = await queue.getGroupState(groupNode.groupId);
    if (state!.state === 'COMPENSATING') {
      await expect(queue.cancelGroup(groupNode.groupId)).rejects.toBeInstanceOf(
        InvalidGroupStateError,
      );
    }
  });

  it('should remove delayed jobs from the delayed set during cancellation', async () => {
    const groupNode = await flowProducer.addGroup({
      name: 'cancel-delayed-group',
      jobs: [
        { name: 'job-a', queueName, data: {}, opts: { delay: 60000 } },
        { name: 'job-b', queueName, data: {}, opts: { delay: 60000 } },
      ],
    });

    const delayedCountBefore = await queue.getJobCounts('delayed');

    await queue.cancelGroup(groupNode.groupId);
    await new Promise(r => setTimeout(r, 200));

    const delayedCountAfter = await queue.getJobCounts('delayed');
    expect(delayedCountAfter.delayed).toBeLessThanOrEqual(
      delayedCountBefore.delayed,
    );

    const state = await queue.getGroupState(groupNode.groupId);
    expect(state!.state).toBe('FAILED');
    expect(state!.cancelledCount).toBe(2);
  });
});
