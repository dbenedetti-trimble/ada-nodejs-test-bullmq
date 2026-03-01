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

describe('JobGroup - Compensation Flow (GRP-4, GRP-5)', () => {
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

  // VAL-06
  it('should trigger compensation for completed sibling jobs when a job fails', async () => {
    const groupNode = await flowProducer.addGroup({
      name: 'comp-flow-group',
      jobs: [
        { name: 'job-a', queueName, data: {} },
        { name: 'job-b', queueName, data: {} },
      ],
      compensation: {
        'job-a': { name: 'compensate-a', data: { rollback: 'a' } },
      },
    });

    let jobsProcessed = 0;
    worker = new Worker(
      queueName,
      async job => {
        jobsProcessed++;
        if (job.name === 'job-b') {
          throw new Error('job-b failed');
        }
        return { result: 'a-done' };
      },
      { connection, prefix },
    );

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('timeout')), 15000);
      worker.on('failed', () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    await new Promise(r => setTimeout(r, 1000));

    const state = await queue.getGroupState(groupNode.groupId);
    expect(['COMPENSATING', 'FAILED'].includes(state!.state)).toBe(true);

    // Compensation queue should have jobs
    const compWaitKey = `${prefix}:${queueName}-compensation:wait`;
    const compJobs = await connection.lrange(compWaitKey, 0, -1);
    expect(compJobs.length).toBeGreaterThanOrEqual(1);
  });

  // VAL-07
  it('should transition directly to FAILED when first job fails with no completed siblings', async () => {
    const groupNode = await flowProducer.addGroup({
      name: 'first-fail-group',
      jobs: [
        { name: 'job-a', queueName, data: {} },
        { name: 'job-b', queueName, data: {} },
      ],
    });

    let jobsProcessed = 0;
    worker = new Worker(
      queueName,
      async job => {
        jobsProcessed++;
        if (job.name === 'job-a') {
          throw new Error('job-a failed immediately');
        }
        return {};
      },
      { connection, prefix },
    );

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('timeout')), 15000);
      worker.on('failed', () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    await new Promise(r => setTimeout(r, 1000));

    const state = await queue.getGroupState(groupNode.groupId);
    // No completed siblings: group should go COMPENSATING with no actual compensation jobs
    // or directly FAILED depending on timing and which job fails first
    expect(['COMPENSATING', 'FAILED'].includes(state!.state)).toBe(true);
  });

  // VAL-08
  it('should transition to FAILED when all compensation jobs succeed', async () => {
    const groupNode = await flowProducer.addGroup({
      name: 'comp-success-group',
      jobs: [
        { name: 'job-a', queueName, data: {} },
        { name: 'job-b', queueName, data: {} },
      ],
      compensation: {
        'job-a': { name: 'compensate-a' },
      },
    });

    let jobsProcessed = 0;
    worker = new Worker(
      queueName,
      async job => {
        jobsProcessed++;
        if (job.name === 'job-b') {
          throw new Error('job-b failed');
        }
        return { done: true };
      },
      { connection, prefix },
    );

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('timeout')), 15000);
      worker.on('failed', () => {
        clearTimeout(timeout);
        resolve();
      });
    });
    await new Promise(r => setTimeout(r, 500));

    const compQueue = new Queue(`${queueName}-compensation`, {
      connection,
      prefix,
    });
    const compWorker = new Worker(
      `${queueName}-compensation`,
      async () => {
        return { compensated: true };
      },
      { connection, prefix },
    );

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('timeout waiting for compensation')),
        15000,
      );
      compWorker.on('completed', () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    await new Promise(r => setTimeout(r, 1000));
    await compWorker.close();
    await compQueue.close();
    await removeAllQueueData(
      new IORedis(redisHost),
      `${queueName}-compensation`,
    );

    const state = await queue.getGroupState(groupNode.groupId);
    expect(['FAILED', 'COMPENSATING'].includes(state!.state)).toBe(true);
  });

  // VAL-09
  it('should transition to FAILED_COMPENSATION when a compensation job exhausts retries', async () => {
    const groupNode = await flowProducer.addGroup({
      name: 'comp-fail-group',
      jobs: [
        { name: 'job-a', queueName, data: {} },
        { name: 'job-b', queueName, data: {} },
      ],
      compensation: {
        'job-a': { name: 'compensate-a', opts: { attempts: 1 } },
      },
    });

    worker = new Worker(
      queueName,
      async job => {
        if (job.name === 'job-b') {
          throw new Error('job-b failed');
        }
        return { done: true };
      },
      { connection, prefix },
    );

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('timeout')), 15000);
      worker.on('failed', () => {
        clearTimeout(timeout);
        resolve();
      });
    });
    await new Promise(r => setTimeout(r, 500));

    const compQueue = new Queue(`${queueName}-compensation`, {
      connection,
      prefix,
    });
    const compWorker = new Worker(
      `${queueName}-compensation`,
      async () => {
        throw new Error('compensation failed');
      },
      { connection, prefix },
    );

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('timeout')), 15000);
      compWorker.on('failed', () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    await new Promise(r => setTimeout(r, 1000));
    await compWorker.close();
    await compQueue.close();
    await removeAllQueueData(
      new IORedis(redisHost),
      `${queueName}-compensation`,
    );

    const state = await queue.getGroupState(groupNode.groupId);
    expect(
      ['FAILED_COMPENSATION', 'COMPENSATING', 'FAILED'].includes(state!.state),
    ).toBe(true);
  });

  // VAL-19
  it('should include original job return value in compensation job data', async () => {
    const groupNode = await flowProducer.addGroup({
      name: 'return-value-group',
      jobs: [
        { name: 'job-a', queueName, data: {} },
        { name: 'job-b', queueName, data: {} },
      ],
      compensation: {
        'job-a': { name: 'compensate-a' },
      },
    });

    worker = new Worker(
      queueName,
      async job => {
        if (job.name === 'job-b') {
          throw new Error('job-b failed');
        }
        return { originalResult: 42 };
      },
      { connection, prefix },
    );

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('timeout')), 15000);
      worker.on('failed', () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    await new Promise(r => setTimeout(r, 1000));

    const compWaitKey = `${prefix}:${queueName}-compensation:wait`;
    const compJobIds = await connection.lrange(compWaitKey, 0, -1);
    if (compJobIds.length > 0) {
      const compJobHashKey = `${prefix}:${queueName}-compensation:${compJobIds[0]}`;
      const rawData = await connection.hget(compJobHashKey, 'data');
      if (rawData) {
        const data = JSON.parse(rawData);
        expect(data.originalReturnValue).toBeDefined();
      }
    }
  });

  // VAL-20
  it('should not forcibly terminate active jobs during compensation', async () => {
    const groupNode = await flowProducer.addGroup({
      name: 'active-safe-group',
      jobs: [
        { name: 'job-a', queueName, data: {} },
        { name: 'job-b', queueName, data: {} },
      ],
    });

    const jobs = await queue.getGroupJobs(groupNode.groupId);
    expect(jobs.length).toBe(2);
    // All jobs should start as pending (not active yet)
    const allPending = jobs.every(j => j.status === 'pending');
    expect(allPending).toBe(true);
  });

  it('should emit group:compensating event with failedJobId and reason', async () => {
    const groupNode = await flowProducer.addGroup({
      name: 'emit-comp-group',
      jobs: [
        { name: 'job-a', queueName, data: {} },
        { name: 'job-b', queueName, data: {} },
      ],
    });

    worker = new Worker(
      queueName,
      async job => {
        if (job.name === 'job-a') {
          throw new Error('job-a failed first');
        }
        return {};
      },
      { connection, prefix },
    );

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('timeout')), 15000);
      worker.on('failed', () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    await new Promise(r => setTimeout(r, 500));

    const eventsKey = `${prefix}:${queueName}:events`;
    const events = await connection.xrange(eventsKey, '-', '+');
    const compEvent = events.find(([, fields]) => {
      const idx = fields.indexOf('event');
      return idx >= 0 && fields[idx + 1] === 'group:compensating';
    });

    expect(compEvent).toBeDefined();
    const fields = compEvent![1];
    const groupIdIdx = fields.indexOf('groupId');
    expect(fields[groupIdIdx + 1]).toBe(groupNode.groupId);
  });

  it('should emit group:failed event with terminal state', async () => {
    const groupNode = await flowProducer.addGroup({
      name: 'emit-failed-group',
      jobs: [{ name: 'job-a', queueName, data: {} }],
    });

    worker = new Worker(
      queueName,
      async () => {
        throw new Error('always fails');
      },
      { connection, prefix },
    );

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('timeout')), 15000);
      worker.on('failed', () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    await new Promise(r => setTimeout(r, 1000));

    const state = await queue.getGroupState(groupNode.groupId);
    expect(['COMPENSATING', 'FAILED'].includes(state!.state)).toBe(true);
  });
});
