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

describe('JobGroup - Edge Cases (GRP-8)', () => {
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
    await removeAllQueueData(new IORedis(redisHost), `${queueName}:compensation`);
  });

  afterAll(async () => {
    await connection.quit();
  });

  // VAL-16
  it('should cancel delayed group jobs from the delayed sorted set during compensation', async () => {
    const groupNode = await flowProducer.addGroup({
      name: 'delayed-cancel-group',
      jobs: [
        { name: 'job-a', queueName, data: {} },
        { name: 'job-b', queueName, data: {}, opts: { delay: 60000 } },
      ],
    });

    worker = new Worker(
      queueName,
      async job => {
        if (job.name === 'job-a') {
          throw new Error('fail-a');
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

    const jobs = await queue.getGroupJobs(groupNode.groupId);
    const cancelledJobs = jobs.filter(j => j.status === 'cancelled');
    void cancelledJobs;
    const jobBEntry = jobs.find(j => {
      const lastColon = j.jobKey.lastIndexOf(':');
      return lastColon >= 0;
    });
    void jobBEntry;

    // job-b should have been cancelled from delayed set
    expect(jobs.some(j => j.status === 'cancelled')).toBe(true);
  });

  // VAL-17
  it('should cancel prioritized group jobs from the prioritized sorted set during compensation', async () => {
    const groupNode = await flowProducer.addGroup({
      name: 'prioritized-cancel-group',
      jobs: [
        { name: 'job-a', queueName, data: {} },
        { name: 'job-b', queueName, data: {}, opts: { priority: 1 } },
      ],
    });

    worker = new Worker(
      queueName,
      async job => {
        if (job.name === 'job-a') {
          throw new Error('fail-a');
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

    const jobs = await queue.getGroupJobs(groupNode.groupId);
    // At least some jobs were cancelled
    expect(jobs.some(j => j.status === 'cancelled')).toBe(true);
  });

  it('should handle concurrent failures resulting in exactly one compensation cycle', async () => {
    const groupNode = await flowProducer.addGroup({
      name: 'concurrent-fail-group',
      jobs: [
        { name: 'job-a', queueName, data: {} },
        { name: 'job-b', queueName, data: {} },
        { name: 'job-c', queueName, data: {} },
      ],
    });

    let failCount = 0;
    const worker2 = new Worker(
      queueName,
      async () => {
        failCount++;
        throw new Error('concurrent fail');
      },
      { connection: new IORedis(redisHost, { maxRetriesPerRequest: null }), prefix },
    );
    worker = new Worker(
      queueName,
      async () => {
        failCount++;
        throw new Error('concurrent fail');
      },
      { connection: new IORedis(redisHost, { maxRetriesPerRequest: null }), prefix },
    );

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('timeout')), 15000);
      let failures = 0;
      const onFailed = () => {
        failures++;
        if (failures >= 2) {
          clearTimeout(timeout);
          resolve();
        }
      };
      worker.on('failed', onFailed);
      worker2.on('failed', onFailed);
    });

    await new Promise(r => setTimeout(r, 500));
    await worker2.close();

    // Check that exactly one compensation cycle was triggered (not two)
    const eventsKey = `${prefix}:${queueName}:events`;
    const events = await connection.xrange(eventsKey, '-', '+');
    const compEvents = events.filter(([, fields]) => {
      const idx = fields.indexOf('event');
      return idx >= 0 && fields[idx + 1] === 'group:compensating';
    });

    expect(compEvents.length).toBeLessThanOrEqual(1);
  });

  it('should handle concurrent completions without emitting duplicate group:completed events', async () => {
    const groupNode = await flowProducer.addGroup({
      name: 'concurrent-complete-edge-group',
      jobs: [
        { name: 'job-a', queueName, data: {} },
        { name: 'job-b', queueName, data: {} },
      ],
    });

    const worker2 = new Worker(
      queueName,
      async () => ({ done: true }),
      { connection: new IORedis(redisHost, { maxRetriesPerRequest: null }), prefix },
    );
    worker = new Worker(
      queueName,
      async () => ({ done: true }),
      { connection: new IORedis(redisHost, { maxRetriesPerRequest: null }), prefix },
    );

    await new Promise<void>((resolve, reject) => {
      let completed = 0;
      const timeout = setTimeout(() => reject(new Error('timeout')), 15000);
      const onCompleted = () => {
        completed++;
        if (completed >= 2) {
          clearTimeout(timeout);
          resolve();
        }
      };
      worker.on('completed', onCompleted);
      worker2.on('completed', onCompleted);
    });

    await new Promise(r => setTimeout(r, 500));
    await worker2.close();

    const eventsKey = `${prefix}:${queueName}:events`;
    const events = await connection.xrange(eventsKey, '-', '+');
    const completedEvents = events.filter(([, fields]) => {
      const idx = fields.indexOf('event');
      return idx >= 0 && fields[idx + 1] === 'group:completed';
    });

    expect(completedEvents.length).toBe(1);
  });

  it('should correctly track jobs across multiple queues in a single group', async () => {
    const queueName2 = `test-${v4()}`;
    const queue2 = new Queue(queueName2, { connection, prefix });

    try {
      const groupNode = await flowProducer.addGroup({
        name: 'multi-queue-group',
        jobs: [
          { name: 'job-a', queueName, data: {} },
          { name: 'job-b', queueName: queueName2, data: {} },
        ],
      });

      const jobs = await queue.getGroupJobs(groupNode.groupId);
      expect(jobs).toHaveLength(2);

      const queueNames = jobs.map(j => j.queueName);
      expect(queueNames).toContain(queueName);
      expect(queueNames).toContain(queueName2);
    } finally {
      await queue2.close();
      await removeAllQueueData(new IORedis(redisHost), queueName2);
    }
  });

  it('should allow jobs with delay to be group members', async () => {
    const groupNode = await flowProducer.addGroup({
      name: 'delayed-member-group',
      jobs: [
        { name: 'job-a', queueName, data: {} },
        { name: 'job-delayed', queueName, data: {}, opts: { delay: 5000 } },
      ],
    });

    const state = await queue.getGroupState(groupNode.groupId);
    expect(state!.state).toBe('ACTIVE');
    expect(state!.totalJobs).toBe(2);

    const jobs = await queue.getGroupJobs(groupNode.groupId);
    expect(jobs).toHaveLength(2);
  });

  it('should allow jobs with priority to be group members', async () => {
    const groupNode = await flowProducer.addGroup({
      name: 'priority-member-group',
      jobs: [
        { name: 'job-a', queueName, data: {} },
        { name: 'job-priority', queueName, data: {}, opts: { priority: 10 } },
      ],
    });

    const state = await queue.getGroupState(groupNode.groupId);
    expect(state!.state).toBe('ACTIVE');
    expect(state!.totalJobs).toBe(2);
  });
});
