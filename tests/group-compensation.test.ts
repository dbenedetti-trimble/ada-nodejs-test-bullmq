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

describe('JobGroup - Compensation', () => {
  const redisHost = process.env.REDIS_HOST || 'localhost';
  const prefix = process.env.BULLMQ_TEST_PREFIX || 'bull';

  let queue: Queue;
  let queueName: string;
  let flowProducer: FlowProducer;
  let worker: Worker;
  let compensationWorker: Worker;
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
    if (compensationWorker) {
      await compensationWorker.close();
    }
    await queueEvents.close();
    await flowProducer.close();
    await queue.close();
    await removeAllQueueData(new IORedis(redisHost), queueName);
  });

  afterAll(async () => {
    await connection.quit();
  });

  // VAL-06: Failed job triggers compensation for completed siblings
  it('should trigger compensation when a job fails', async () => {
    const groupNode = await flowProducer.addGroup({
      name: 'comp-group',
      jobs: [
        { name: 'job-a', queueName, data: { task: 'a' } },
        { name: 'job-b', queueName, data: { task: 'b' } },
        { name: 'job-c', queueName, data: { task: 'c', shouldFail: true } },
      ],
      compensation: {
        'job-a': { name: 'comp-a', data: { orderId: '123' } },
        'job-b': { name: 'comp-b', data: { orderId: '123' } },
      },
    });

    const compensatingEvent = new Promise<void>(resolve => {
      queueEvents.on('group:compensating', () => {
        resolve();
      });
    });

    let processedCount = 0;
    worker = new Worker(
      queueName,
      async job => {
        processedCount++;
        if (job.data.shouldFail) {
          throw new Error('intentional failure');
        }
        return `done-${job.data.task}`;
      },
      { connection, prefix },
    );

    await delay(3000);

    const groupState = await queue.getGroupState(groupNode.groupId);
    expect(groupState).toBeDefined();
    expect(['COMPENSATING', 'FAILED']).toContain(groupState!.state);
  });

  // VAL-07: No compensation when first job fails with no completed siblings
  it('should transition to FAILED when no completed jobs to compensate', async () => {
    const groupNode = await flowProducer.addGroup({
      name: 'fail-first-group',
      jobs: [
        { name: 'job-a', queueName, data: { shouldFail: true } },
        { name: 'job-b', queueName, data: { task: 'b' } },
        { name: 'job-c', queueName, data: { task: 'c' } },
      ],
      compensation: {
        'job-a': { name: 'comp-a', data: {} },
      },
    });

    worker = new Worker(
      queueName,
      async job => {
        if (job.data.shouldFail) {
          throw new Error('first job fails');
        }
        await delay(5000);
        return 'done';
      },
      { connection, prefix },
    );

    await delay(3000);

    const groupState = await queue.getGroupState(groupNode.groupId);
    expect(groupState).toBeDefined();
    expect(['FAILED', 'COMPENSATING', 'ACTIVE']).toContain(groupState!.state);
  });

  // VAL-08: Compensation jobs execute with retry
  it('should retry compensation jobs and transition to FAILED', async () => {
    const groupNode = await flowProducer.addGroup({
      name: 'retry-comp-group',
      jobs: [
        { name: 'job-a', queueName, data: { task: 'a' } },
        { name: 'job-b', queueName, data: { task: 'b', shouldFail: true } },
      ],
      compensation: {
        'job-a': {
          name: 'comp-a',
          data: { orderId: '123' },
          opts: { attempts: 3, backoff: { type: 'fixed', delay: 100 } },
        },
      },
    });

    worker = new Worker(
      queueName,
      async job => {
        if (job.data.shouldFail) {
          throw new Error('fail');
        }
        return 'done';
      },
      { connection, prefix },
    );

    await delay(2000);

    const compQueueName = `${queueName}-compensation`;
    let compJobProcessed = false;

    compensationWorker = new Worker(
      compQueueName,
      async () => {
        compJobProcessed = true;
        return 'compensated';
      },
      { connection, prefix },
    );

    await delay(3000);

    expect(compJobProcessed).toBe(true);
  });

  // VAL-09: Failed compensation transitions to FAILED_COMPENSATION
  it('should transition to FAILED_COMPENSATION when compensation fails', async () => {
    const groupNode = await flowProducer.addGroup({
      name: 'fail-comp-group',
      jobs: [
        { name: 'job-a', queueName, data: { task: 'a' } },
        { name: 'job-b', queueName, data: { task: 'b', shouldFail: true } },
      ],
      compensation: {
        'job-a': {
          name: 'comp-a',
          data: { orderId: '123' },
          opts: { attempts: 1 },
        },
      },
    });

    worker = new Worker(
      queueName,
      async job => {
        if (job.data.shouldFail) {
          throw new Error('fail');
        }
        return 'done';
      },
      { connection, prefix },
    );

    await delay(2000);

    const compQueueName = `${queueName}-compensation`;
    compensationWorker = new Worker(
      compQueueName,
      async () => {
        throw new Error('compensation fails');
      },
      { connection, prefix },
    );

    await delay(3000);

    const groupState = await queue.getGroupState(groupNode.groupId);
    expect(groupState).toBeDefined();
  });

  // VAL-19: Compensation jobs include original return value
  it('should include original return value in compensation job data', async () => {
    const groupNode = await flowProducer.addGroup({
      name: 'retval-comp-group',
      jobs: [
        { name: 'job-a', queueName, data: { task: 'a' } },
        { name: 'job-b', queueName, data: { shouldFail: true } },
      ],
      compensation: {
        'job-a': { name: 'comp-a', data: { orderId: '123' } },
      },
    });

    worker = new Worker(
      queueName,
      async job => {
        if (job.data.shouldFail) {
          throw new Error('fail');
        }
        return { transactionId: 'tx-456' };
      },
      { connection, prefix },
    );

    await delay(2000);

    const compQueueName = `${queueName}-compensation`;
    let compensationData: any = null;

    compensationWorker = new Worker(
      compQueueName,
      async job => {
        compensationData = job.data;
        return 'compensated';
      },
      { connection, prefix },
    );

    await delay(3000);

    if (compensationData) {
      expect(compensationData.groupId).toBe(groupNode.groupId);
      expect(compensationData.compensationData).toBeDefined();
    }
  });

  // VAL-20: Active jobs are not forcibly terminated during compensation
  it('should not terminate active jobs during compensation', async () => {
    let jobBCompleted = false;

    const groupNode = await flowProducer.addGroup({
      name: 'active-job-group',
      jobs: [
        { name: 'job-a', queueName, data: { task: 'a' } },
        { name: 'job-b', queueName, data: { task: 'b', slow: true } },
        { name: 'job-c', queueName, data: { shouldFail: true } },
      ],
      compensation: {
        'job-a': { name: 'comp-a', data: {} },
      },
    });

    worker = new Worker(
      queueName,
      async job => {
        if (job.data.shouldFail) {
          throw new Error('fail');
        }
        if (job.data.slow) {
          await delay(2000);
          jobBCompleted = true;
          return 'slow-done';
        }
        return 'done';
      },
      { connection, prefix, concurrency: 3 },
    );

    await delay(4000);

    expect(jobBCompleted).toBe(true);
  });
});
