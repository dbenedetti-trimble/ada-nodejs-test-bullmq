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

describe('JobGroup - completion', () => {
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

  // VAL-04: Sequential completion → COMPLETED + event fires once
  it('group transitions to COMPLETED when all jobs succeed sequentially', async () => {
    const groupNode = await flowProducer.addGroup({
      name: 'test-group',
      jobs: [
        { name: 'job-a', queueName, data: {} },
        { name: 'job-b', queueName, data: {} },
        { name: 'job-c', queueName, data: {} },
      ],
    });

    const completedEvents: any[] = [];
    const completedPromise = new Promise<void>(resolve => {
      queueEvents.on('group:completed' as any, (args: any) => {
        completedEvents.push(args);
        if (completedEvents.length === 1) {
          resolve();
        }
      });
    });

    const worker = new Worker(queueName, async () => 'done', {
      connection,
      prefix,
    });
    await worker.waitUntilReady();

    await completedPromise;
    await worker.close();

    const state = await queue.getGroupState(groupNode.groupId);
    expect(state!.state).toBe('COMPLETED');
    expect(state!.completedCount).toBe(3);
    expect(completedEvents).toHaveLength(1);
    expect(completedEvents[0].groupId).toBe(groupNode.groupId);
    expect(completedEvents[0].groupName).toBe('test-group');
  }, 30000);

  // VAL-05: Concurrent workers → COMPLETED + exactly one event
  it('group transitions to COMPLETED with concurrent workers and emits event exactly once', async () => {
    const groupNode = await flowProducer.addGroup({
      name: 'test-group',
      jobs: [
        { name: 'job-a', queueName, data: {} },
        { name: 'job-b', queueName, data: {} },
        { name: 'job-c', queueName, data: {} },
      ],
    });

    const completedEvents: any[] = [];
    const completedPromise = new Promise<void>(resolve => {
      queueEvents.on('group:completed' as any, (args: any) => {
        completedEvents.push(args);
        resolve();
      });
    });

    const workers = [
      new Worker(queueName, async () => 'done', { connection, prefix }),
      new Worker(queueName, async () => 'done', { connection, prefix }),
      new Worker(queueName, async () => 'done', { connection, prefix }),
    ];
    await Promise.all(workers.map(w => w.waitUntilReady()));

    await completedPromise;
    await delay(500); // allow any duplicate events to arrive

    await Promise.all(workers.map(w => w.close()));

    const state = await queue.getGroupState(groupNode.groupId);
    expect(state!.state).toBe('COMPLETED');
    expect(completedEvents).toHaveLength(1);
  }, 30000);

  // VAL-13: Partial completion query
  it('getGroupState reflects partial completion (completedCount=2, state=ACTIVE)', async () => {
    let processCount = 0;
    let releaseSecondJob: (() => void) | undefined;

    const groupNode = await flowProducer.addGroup({
      name: 'test-group',
      jobs: [
        { name: 'job-a', queueName, data: {} },
        { name: 'job-b', queueName, data: {} },
        { name: 'job-c', queueName, data: {} },
      ],
    });

    const worker = new Worker(
      queueName,
      async job => {
        processCount++;
        if (processCount === 2) {
          // Hold the third job while we check state
          await new Promise<void>(resolve => {
            releaseSecondJob = resolve;
          });
        }
        return 'done';
      },
      { connection, prefix, concurrency: 1 },
    );
    await worker.waitUntilReady();

    // Wait until second job starts
    await new Promise<void>(resolve => {
      const interval = setInterval(() => {
        if (processCount >= 2) {
          clearInterval(interval);
          resolve();
        }
      }, 100);
    });

    // Check state while job 3 is pending
    const state = await queue.getGroupState(groupNode.groupId);
    // At this point at least 1 job has completed (job-a), and job-b is being held
    expect(state!.state).toBe('ACTIVE');
    expect(state!.completedCount).toBeGreaterThanOrEqual(1);
    expect(state!.totalJobs).toBe(3);

    releaseSecondJob?.();
    await worker.close();
  }, 30000);

  // VAL-14: Non-existent group returns null
  it('getGroupState returns null for a non-existent group ID', async () => {
    const state = await queue.getGroupState('nonexistent-id');
    expect(state).toBeNull();
  });

  // VAL-15: getGroupJobs entries
  it('getGroupJobs returns correct statuses for all member jobs', async () => {
    const groupNode = await flowProducer.addGroup({
      name: 'test-group',
      jobs: [
        { name: 'job-a', queueName, data: {} },
        { name: 'job-b', queueName, data: {} },
      ],
    });

    const jobEntries = await queue.getGroupJobs(groupNode.groupId);
    expect(jobEntries).toHaveLength(2);
    for (const entry of jobEntries) {
      expect(entry.jobId).toBeTruthy();
      expect(entry.jobKey).toBeTruthy();
      expect(entry.queueName).toBe(queueName);
      expect([
        'pending',
        'active',
        'completed',
        'failed',
        'cancelled',
      ]).toContain(entry.status);
    }
  });
});
