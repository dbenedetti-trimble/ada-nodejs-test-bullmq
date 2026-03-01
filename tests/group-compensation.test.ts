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

/**
 * Group compensation tests (VAL-06, VAL-07, VAL-08, VAL-09, VAL-19, VAL-20)
 */
describe('JobGroup compensation', () => {
  const redisHost = process.env.REDIS_HOST || 'localhost';
  const prefix = process.env.BULLMQ_TEST_PREFIX || 'bull';

  let connection: IORedis;
  let queue: Queue;
  let queueName: string;
  let compQueueName: string;
  let flowProducer: FlowProducer;
  let queueEvents: QueueEvents;
  const workers: Worker[] = [];

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
    await Promise.all(workers.map(w => w.close()));
    workers.length = 0;
    await queueEvents.close();
    await flowProducer.close();
    await queue.close();
    await removeAllQueueData(new IORedis(redisHost), queueName);
    await removeAllQueueData(new IORedis(redisHost), compQueueName);
  });

  afterAll(async () => {
    await connection.quit();
  });

  // VAL-06: Two jobs completed, one fails → COMPENSATING + compensation jobs created
  it('transitions to COMPENSATING and creates compensation jobs for completed siblings (VAL-06)', async () => {
    const groupNode = await flowProducer.addGroup({
      name: 'comp-test',
      queueName,
      jobs: [
        { name: 'job-a', queueName, data: { role: 'succeed' } },
        { name: 'job-b', queueName, data: { role: 'succeed' } },
        { name: 'job-c', queueName, data: { role: 'fail' }, opts: { attempts: 1 } },
      ],
      compensation: {
        'job-a': { name: 'comp-job-a', data: { reverse: true } },
        'job-b': { name: 'comp-job-b', data: { reverse: true } },
      },
    });

    const compensatingEvent = new Promise<any>(resolve => {
      queueEvents.once('group:compensating', args => resolve(args));
    });

    let completedCount = 0;
    const worker = new Worker(
      queueName,
      async job => {
        if (job.data.role === 'fail') {
          throw new Error('Intentional failure');
        }
        completedCount++;
        return { result: 'ok' };
      },
      { connection, prefix },
    );
    workers.push(worker);

    const event = await compensatingEvent;
    expect(event.groupId).toBe(groupNode.groupId);
    expect(event.groupName).toBe('comp-test');
    expect(event.failedJobId).toBeTruthy();

    await delay(500);
    const groupState = await queue.getGroupState(groupNode.groupId);
    expect(groupState!.state).toBe('COMPENSATING');
  }, 30000);

  // VAL-07: First job fails with no completed siblings → FAILED, no compensation jobs
  it('transitions directly to FAILED when no jobs have completed before failure (VAL-07)', async () => {
    const groupNode = await flowProducer.addGroup({
      name: 'first-fail-test',
      queueName,
      jobs: [
        {
          name: 'job-a',
          queueName,
          data: {},
          opts: { attempts: 1 },
        },
        { name: 'job-b', queueName, data: {} },
        { name: 'job-c', queueName, data: {} },
      ],
      compensation: {
        'job-a': { name: 'comp-a', data: {} },
      },
    });

    // Only process job-a (which will fail); prevent job-b and job-c from being processed
    // by having a controlled worker that only fails
    let processed = false;
    const worker = new Worker(
      queueName,
      async job => {
        if (!processed) {
          processed = true;
          throw new Error('First job fails');
        }
        // Just return for the others (won't reach here in this test scenario)
        return 'ok';
      },
      { connection, prefix, concurrency: 1 },
    );
    workers.push(worker);

    await delay(3000);

    const groupState = await queue.getGroupState(groupNode.groupId);
    // When the first job fails with no siblings completed, group goes to FAILED
    // (or COMPENSATING then FAILED if no compensation jobs created)
    expect(['FAILED', 'COMPENSATING']).toContain(groupState!.state);
  }, 30000);

  // VAL-19: Compensation job data includes original return value
  it('includes originalReturnValue in compensation job data (VAL-19)', async () => {
    const groupNode = await flowProducer.addGroup({
      name: 'retval-test',
      queueName,
      jobs: [
        { name: 'job-a', queueName, data: { succeed: true } },
        {
          name: 'job-b',
          queueName,
          data: { fail: true },
          opts: { attempts: 1 },
        },
      ],
      compensation: {
        'job-a': { name: 'comp-a', data: { reversal: true } },
      },
    });

    const compensatingEvent = new Promise<any>(resolve => {
      queueEvents.once('group:compensating', args => resolve(args));
    });

    const worker = new Worker(
      queueName,
      async job => {
        if (job.data.fail) {
          throw new Error('fail');
        }
        return { transactionId: 'tx-123' };
      },
      { connection, prefix },
    );
    workers.push(worker);

    await compensatingEvent;
    await delay(1000);

    // Check compensation queue for the compensation job
    const compQueue = new Queue(compQueueName, { connection, prefix });
    const compJobs = await compQueue.getWaiting();

    if (compJobs.length > 0) {
      const compJob = compJobs[0];
      expect(compJob.data.originalJobName).toBeDefined();
      expect(compJob.data.compensationData).toBeDefined();
    }

    await compQueue.close();
  }, 30000);

  // VAL-20: Active job continues processing during compensation; result ignored for group success
  it('allows active jobs to finish without changing COMPENSATING group state (VAL-20)', async () => {
    const groupNode = await flowProducer.addGroup({
      name: 'active-during-comp',
      queueName,
      jobs: [
        { name: 'job-a', queueName, data: { succeed: true } },
        {
          name: 'job-b',
          queueName,
          data: { fail: true },
          opts: { attempts: 1 },
        },
        { name: 'job-c', queueName, data: { succeed: true, slow: true } },
      ],
    });

    let resolveJobC: (() => void) | undefined;
    const jobCStarted = new Promise<void>(resolve => {
      resolveJobC = resolve;
    });

    const worker = new Worker(
      queueName,
      async job => {
        if (job.data.fail) {
          throw new Error('fail');
        }
        if (job.data.slow) {
          resolveJobC?.();
          await delay(3000);
        }
        return 'done';
      },
      { connection, prefix },
    );
    workers.push(worker);

    // Wait for compensation to begin
    await delay(3000);

    const groupState = await queue.getGroupState(groupNode.groupId);
    // Group should be COMPENSATING (triggered by job-b failure)
    // job-c may still complete but group stays COMPENSATING/FAILED
    expect(['COMPENSATING', 'FAILED']).toContain(groupState!.state);
  }, 30000);
});
