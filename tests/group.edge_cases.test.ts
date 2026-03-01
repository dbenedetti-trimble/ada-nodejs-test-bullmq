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

describe('JobGroup - edge cases', () => {
  const redisHost = process.env.REDIS_HOST || 'localhost';
  const prefix = process.env.BULLMQ_TEST_PREFIX || 'bull';

  let connection: IORedis;
  let queue: Queue;
  let queueName: string;
  let flowProducer: FlowProducer;
  let queueEvents: QueueEvents;

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
    await queue.close();
    await flowProducer.close();
    await queueEvents.close();
    await removeAllQueueData(new IORedis(redisHost), queueName);
  });

  afterAll(async () => {
    await connection.quit();
  });

  // VAL-16: Delayed job in group removed from delayed set during compensation
  it('delayed group job is removed from delayed set during compensation', async () => {
    const groupNode = await flowProducer.addGroup({
      name: 'delayed-test',
      jobs: [
        { name: 'job-a', queueName, data: {} },
        { name: 'job-b', queueName, data: {}, opts: { delay: 60000 } },
      ],
    });

    // job-b should be in delayed set initially
    const initialDelayed = await connection.zcard(
      `${prefix}:${queueName}:delayed`,
    );
    expect(initialDelayed).toBeGreaterThan(0);

    const compensatingPromise = new Promise<void>(resolve => {
      queueEvents.on('group:compensating' as any, () => resolve());
    });
    const failedPromise = new Promise<void>(resolve => {
      queueEvents.on('group:failed' as any, () => resolve());
    });

    const worker = new Worker(
      queueName,
      async () => {
        throw new Error('job-a failed');
      },
      { connection, prefix },
    );
    await worker.waitUntilReady();

    // Wait for either compensating (job-a had no completed siblings → FAILED) or compensating
    await Promise.race([compensatingPromise, failedPromise]);
    await worker.close();

    // job-b should be removed from delayed set
    const delayedCount = await connection.zcard(
      `${prefix}:${queueName}:delayed`,
    );
    expect(delayedCount).toBe(0);

    // job-b status in group should be 'cancelled'
    const entries = await queue.getGroupJobs(groupNode.groupId);
    const jobBEntry = entries.find(e => {
      const id = groupNode.jobs[1].id;
      return e.jobId === id;
    });
    // The cancelled count should reflect that job-b was cancelled
    const state = await queue.getGroupState(groupNode.groupId);
    expect(state!.cancelledCount).toBeGreaterThan(0);
  }, 30000);

  // VAL-17: Prioritized job in group removed from prioritized set during compensation
  it('prioritized group job is removed from prioritized set during compensation', async () => {
    const groupNode = await flowProducer.addGroup({
      name: 'prioritized-test',
      jobs: [
        { name: 'job-a', queueName, data: {} },
        { name: 'job-b', queueName, data: {}, opts: { priority: 5 } },
      ],
    });

    const failedOrCompensatingPromise = Promise.race([
      new Promise<void>(resolve => {
        queueEvents.on('group:compensating' as any, () => resolve());
      }),
      new Promise<void>(resolve => {
        queueEvents.on('group:failed' as any, () => resolve());
      }),
    ]);

    const worker = new Worker(
      queueName,
      async job => {
        if (job.name === 'job-a') {
          throw new Error('job-a failed');
        }
        return 'done';
      },
      { connection, prefix, concurrency: 1 },
    );
    await worker.waitUntilReady();

    await failedOrCompensatingPromise;
    await worker.close();

    // Check that group jobs hash shows job-b as cancelled
    const state = await queue.getGroupState(groupNode.groupId);
    expect(state!.cancelledCount).toBeGreaterThan(0);

    const entries = await queue.getGroupJobs(groupNode.groupId);
    const cancelledEntries = entries.filter(e => e.status === 'cancelled');
    expect(cancelledEntries.length).toBeGreaterThan(0);
  }, 30000);

  // VAL-05 concurrent variant: concurrent failures deduplicated
  it('concurrent job failures result in exactly one compensation cycle', async () => {
    const compensatingEvents: any[] = [];
    const firstEvent = new Promise<void>(resolve => {
      queueEvents.on('group:compensating' as any, (args: any) => {
        compensatingEvents.push(args);
        resolve();
      });
    });
    const failedEvents: any[] = [];
    const firstFailedEvent = new Promise<void>(resolve => {
      queueEvents.on('group:failed' as any, (args: any) => {
        failedEvents.push(args);
        resolve();
      });
    });

    await flowProducer.addGroup({
      name: 'concurrent-fail-test',
      jobs: [
        { name: 'job-a', queueName, data: {} },
        { name: 'job-b', queueName, data: {} },
        { name: 'job-c', queueName, data: {} },
      ],
    });

    const workers = [
      new Worker(
        queueName,
        async () => {
          throw new Error('fail');
        },
        {
          connection,
          prefix,
        },
      ),
      new Worker(
        queueName,
        async () => {
          throw new Error('fail');
        },
        {
          connection,
          prefix,
        },
      ),
      new Worker(
        queueName,
        async () => {
          throw new Error('fail');
        },
        {
          connection,
          prefix,
        },
      ),
    ];
    await Promise.all(workers.map(w => w.waitUntilReady()));

    // Wait for either compensating or failed (could go either way since no completed jobs)
    await Promise.race([firstEvent, firstFailedEvent]);
    await delay(500); // Allow any duplicate events
    await Promise.all(workers.map(w => w.close()));

    // At most one compensating or failed event
    const totalGroupEvents = compensatingEvents.length + failedEvents.length;
    expect(totalGroupEvents).toBe(1);
  }, 30000);
});
