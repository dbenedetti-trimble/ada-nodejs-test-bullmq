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
import { removeAllQueueData, delay } from '../src/utils';

describe('JobGroup - compensation', () => {
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
    compQueueName = `${queueName}:compensation`;
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

  // VAL-06: Two completed, one fails → COMPENSATING + compensation jobs created
  it('transitions to COMPENSATING when a job fails with completed siblings', async () => {
    const compensatingEvents: any[] = [];
    const compensatingPromise = new Promise<void>(resolve => {
      queueEvents.on('group:compensating' as any, (args: any) => {
        compensatingEvents.push(args);
        resolve();
      });
    });

    const groupNode = await flowProducer.addGroup({
      name: 'order-group',
      jobs: [
        { name: 'job-a', queueName, data: { val: 'A' } },
        { name: 'job-b', queueName, data: { val: 'B' } },
        { name: 'job-c', queueName, data: { val: 'C' } },
      ],
      compensation: {
        'job-a': { name: 'compensate-a', data: { rollback: 'A' } },
        'job-b': { name: 'compensate-b', data: { rollback: 'B' } },
      },
    });

    let processedCount = 0;
    const worker = new Worker(
      queueName,
      async job => {
        processedCount++;
        if (job.name === 'job-c') {
          throw new Error('job-c failed');
        }
        return `result-${job.name}`;
      },
      { connection, prefix, concurrency: 1 },
    );
    await worker.waitUntilReady();

    await compensatingPromise;
    await worker.close();

    const state = await queue.getGroupState(groupNode.groupId);
    expect(state!.state).toBe('COMPENSATING');
    expect(compensatingEvents).toHaveLength(1);
    expect(compensatingEvents[0].groupId).toBe(groupNode.groupId);

    // Verify compensation jobs exist
    const compJobsCount = await connection.llen(
      `${prefix}:${compQueueName}:wait`,
    );
    expect(compJobsCount).toBeGreaterThan(0);
  }, 30000);

  // VAL-07: First job fails, no completed siblings → FAILED directly
  it('transitions directly to FAILED when first job fails with no completed siblings', async () => {
    const failedEvents: any[] = [];
    const failedPromise = new Promise<void>(resolve => {
      queueEvents.on('group:failed' as any, (args: any) => {
        failedEvents.push(args);
        resolve();
      });
    });

    await flowProducer.addGroup({
      name: 'order-group',
      jobs: [
        { name: 'job-a', queueName, data: {} },
        { name: 'job-b', queueName, data: {} },
      ],
      compensation: {
        'job-a': { name: 'compensate-a', data: {} },
      },
    });

    const worker = new Worker(
      queueName,
      async job => {
        if (job.name === 'job-a') {
          throw new Error('first job failed');
        }
        return 'done';
      },
      { connection, prefix, concurrency: 1 },
    );
    await worker.waitUntilReady();

    await failedPromise;
    await worker.close();

    expect(failedEvents).toHaveLength(1);
    expect(failedEvents[0].state).toBe('FAILED');

    // No compensation jobs should exist
    const compJobsCount = await connection.llen(
      `${prefix}:${compQueueName}:wait`,
    );
    expect(compJobsCount).toBe(0);
  }, 30000);

  // VAL-08: Compensation succeeds → FAILED (not FAILED_COMPENSATION)
  it('transitions to FAILED when all compensation jobs succeed', async () => {
    const groupFailedEvents: any[] = [];
    const failedPromise = new Promise<void>(resolve => {
      queueEvents.on('group:failed' as any, (args: any) => {
        groupFailedEvents.push(args);
        resolve();
      });
    });

    await flowProducer.addGroup({
      name: 'comp-test',
      jobs: [
        { name: 'job-a', queueName, data: {} },
        { name: 'job-b', queueName, data: {} },
      ],
      compensation: {
        'job-a': {
          name: 'comp-a',
          data: {},
          opts: { attempts: 1 },
        },
      },
    });

    const failJobB = false;
    const mainWorker = new Worker(
      queueName,
      async job => {
        if (job.name === 'job-b') {
          throw new Error('job-b fails');
        }
        return 'done';
      },
      { connection, prefix, concurrency: 1 },
    );
    await mainWorker.waitUntilReady();

    // Wait for COMPENSATING state
    await new Promise<void>(resolve => {
      queueEvents.on('group:compensating' as any, () => resolve());
    });

    // Start compensation worker
    const compQueue = new Queue(compQueueName, { connection, prefix });
    const compQueueEvents = new QueueEvents(compQueueName, {
      connection,
      prefix,
    });
    await compQueueEvents.waitUntilReady();

    const compWorker = new Worker(
      compQueueName,
      async job => {
        // Compensation job succeeds
        return 'compensated';
      },
      { connection, prefix },
    );
    await compWorker.waitUntilReady();

    await failedPromise;
    await mainWorker.close();
    await compWorker.close();
    await compQueueEvents.close();
    await compQueue.close();

    expect(groupFailedEvents).toHaveLength(1);
    expect(groupFailedEvents[0].state).toBe('FAILED');
  }, 30000);

  // VAL-09: Failed compensation → FAILED_COMPENSATION
  it('transitions to FAILED_COMPENSATION when compensation job exhausts retries', async () => {
    const groupFailedEvents: any[] = [];
    const failedPromise = new Promise<void>(resolve => {
      queueEvents.on('group:failed' as any, (args: any) => {
        groupFailedEvents.push(args);
        resolve();
      });
    });

    await flowProducer.addGroup({
      name: 'comp-fail-test',
      jobs: [
        { name: 'job-a', queueName, data: {} },
        { name: 'job-b', queueName, data: {} },
      ],
      compensation: {
        'job-a': {
          name: 'comp-a',
          data: {},
          opts: { attempts: 1 },
        },
      },
    });

    const mainWorker = new Worker(
      queueName,
      async job => {
        if (job.name === 'job-b') {
          throw new Error('job-b fails');
        }
        return 'done';
      },
      { connection, prefix, concurrency: 1 },
    );
    await mainWorker.waitUntilReady();

    await new Promise<void>(resolve => {
      queueEvents.on('group:compensating' as any, () => resolve());
    });

    const compQueue = new Queue(compQueueName, { connection, prefix });
    const compQueueEvents = new QueueEvents(compQueueName, {
      connection,
      prefix,
    });
    await compQueueEvents.waitUntilReady();

    const compWorker = new Worker(
      compQueueName,
      async () => {
        throw new Error('compensation failed');
      },
      { connection, prefix },
    );
    await compWorker.waitUntilReady();

    await failedPromise;
    await mainWorker.close();
    await compWorker.close();
    await compQueueEvents.close();
    await compQueue.close();

    expect(groupFailedEvents).toHaveLength(1);
    expect(groupFailedEvents[0].state).toBe('FAILED_COMPENSATION');
  }, 30000);

  // VAL-19: Original return value in compensation job data
  it('compensation job data includes originalReturnValue from the completed job', async () => {
    await flowProducer.addGroup({
      name: 'return-value-test',
      jobs: [
        { name: 'job-a', queueName, data: {} },
        { name: 'job-b', queueName, data: {} },
      ],
      compensation: {
        'job-a': { name: 'comp-a', data: { rollback: true } },
      },
    });

    const mainWorker = new Worker(
      queueName,
      async job => {
        if (job.name === 'job-b') {
          throw new Error('job-b fails');
        }
        return { transactionId: 'tx-456' };
      },
      { connection, prefix, concurrency: 1 },
    );
    await mainWorker.waitUntilReady();

    await new Promise<void>(resolve => {
      queueEvents.on('group:compensating' as any, () => resolve());
    });
    await mainWorker.close();

    // Check compensation job data
    const compJobId = await connection.lindex(
      `${prefix}:${compQueueName}:wait`,
      0,
    );
    expect(compJobId).toBeTruthy();

    const compJobData = await connection.hget(
      `${prefix}:${compQueueName}:${compJobId}`,
      'data',
    );
    expect(compJobData).toBeTruthy();
    const parsedData = JSON.parse(compJobData!);
    expect(parsedData.originalReturnValue).toEqual({ transactionId: 'tx-456' });
    expect(parsedData.originalJobName).toBe('job-a');
  }, 30000);
});
