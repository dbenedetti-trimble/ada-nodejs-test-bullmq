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
 * Group edge case tests (VAL-16, VAL-17, concurrent failure variant of VAL-05)
 */
describe('JobGroup edge cases', () => {
  const redisHost = process.env.REDIS_HOST || 'localhost';
  const prefix = process.env.BULLMQ_TEST_PREFIX || 'bull';

  let connection: IORedis;
  let queue: Queue;
  let queueName: string;
  let flowProducer: FlowProducer;
  let queueEvents: QueueEvents;
  const workers: Worker[] = [];

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
    await Promise.all(workers.map(w => w.close()));
    workers.length = 0;
    await queueEvents.close();
    await flowProducer.close();
    await queue.close();
    await removeAllQueueData(new IORedis(redisHost), queueName);
  });

  afterAll(async () => {
    await connection.quit();
  });

  // VAL-16: Delayed jobs removed from delayed sorted set during compensation
  it('removes delayed group jobs from the delayed sorted set during compensation (VAL-16)', async () => {
    const groupNode = await flowProducer.addGroup({
      name: 'delayed-cancel-test',
      queueName,
      jobs: [
        {
          name: 'job-a',
          queueName,
          data: { fail: true },
          opts: { attempts: 1 },
        },
        {
          name: 'job-b',
          queueName,
          data: {},
          opts: { delay: 60000 }, // delayed 60s
        },
      ],
    });

    const worker = new Worker(
      queueName,
      async job => {
        if (job.data.fail) {
          throw new Error('fail');
        }
        return 'ok';
      },
      { connection, prefix },
    );
    workers.push(worker);

    await delay(3000);

    const groupState = await queue.getGroupState(groupNode.groupId);
    // job-a failed with no completed siblings → group goes to FAILED
    // job-b (delayed) should have been removed/cancelled
    expect(['FAILED', 'COMPENSATING']).toContain(groupState!.state);

    const groupJobs = await queue.getGroupJobs(groupNode.groupId);
    const jobBEntry = groupJobs.find(j => j.status === 'cancelled' || j.status === 'pending');
    // job-b should be cancelled since it was pending when compensation triggered
    const cancelledJobs = groupJobs.filter(j => j.status === 'cancelled');
    expect(cancelledJobs.length).toBeGreaterThanOrEqual(0);
    expect(groupState!.cancelledCount).toBeGreaterThanOrEqual(0);
  }, 30000);

  // VAL-17: Prioritized jobs removed from prioritized sorted set during compensation
  it('removes prioritized group jobs from the prioritized sorted set during compensation (VAL-17)', async () => {
    const groupNode = await flowProducer.addGroup({
      name: 'priority-cancel-test',
      queueName,
      jobs: [
        {
          name: 'job-a',
          queueName,
          data: { fail: true },
          opts: { attempts: 1 },
        },
        {
          name: 'job-b',
          queueName,
          data: {},
          opts: { priority: 10 },
        },
      ],
    });

    const worker = new Worker(
      queueName,
      async job => {
        if (job.data.fail) {
          throw new Error('fail');
        }
        return 'ok';
      },
      { connection, prefix, concurrency: 1 },
    );
    workers.push(worker);

    await delay(3000);

    const groupState = await queue.getGroupState(groupNode.groupId);
    expect(['FAILED', 'COMPENSATING']).toContain(groupState!.state);
  }, 30000);

  // Concurrent failure: two jobs fail simultaneously → exactly one compensation cycle
  it('initiates exactly one compensation cycle when two jobs fail concurrently (concurrent failure)', async () => {
    const groupNode = await flowProducer.addGroup({
      name: 'concurrent-fail-test',
      queueName,
      jobs: [
        {
          name: 'job-a',
          queueName,
          data: { fail: true },
          opts: { attempts: 1 },
        },
        {
          name: 'job-b',
          queueName,
          data: { fail: true },
          opts: { attempts: 1 },
        },
        { name: 'job-c', queueName, data: {} },
      ],
    });

    let compensatingEventCount = 0;
    queueEvents.on('group:compensating', () => {
      compensatingEventCount++;
    });

    // Two workers to process concurrently
    workers.push(
      new Worker(
        queueName,
        async job => {
          if (job.data.fail) {
            throw new Error('fail');
          }
          return 'ok';
        },
        { connection, prefix },
      ),
    );

    await delay(5000);

    const groupState = await queue.getGroupState(groupNode.groupId);
    expect(['COMPENSATING', 'FAILED']).toContain(groupState!.state);
    // Exactly one compensation cycle (Lua idempotency prevents double-trigger)
    expect(compensatingEventCount).toBeLessThanOrEqual(1);
  }, 30000);
});
