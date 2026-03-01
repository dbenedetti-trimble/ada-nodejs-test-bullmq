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
 * Group completion tests (VAL-04, VAL-05, VAL-13, VAL-14, VAL-15)
 */
describe('JobGroup completion', () => {
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

  // VAL-04: Three jobs complete sequentially → group transitions to COMPLETED
  it('transitions group to COMPLETED when all jobs succeed sequentially (VAL-04)', async () => {
    const groupNode = await flowProducer.addGroup({
      name: 'completion-test',
      queueName,
      jobs: [
        { name: 'job-a', queueName, data: { n: 1 } },
        { name: 'job-b', queueName, data: { n: 2 } },
        { name: 'job-c', queueName, data: { n: 3 } },
      ],
    });

    const completedEvent = new Promise<{ groupId: string; groupName: string }>(
      resolve => {
        queueEvents.once('group:completed', args => resolve(args));
      },
    );

    const worker = new Worker(
      queueName,
      async () => {
        return 'done';
      },
      { connection, prefix },
    );
    workers.push(worker);

    const { groupId, groupName } = await completedEvent;
    expect(groupId).toBe(groupNode.groupId);
    expect(groupName).toBe('completion-test');

    const groupState = await queue.getGroupState(groupNode.groupId);
    expect(groupState!.state).toBe('COMPLETED');
    expect(groupState!.completedCount).toBe(3);
  }, 30000);

  // VAL-05: Concurrent workers — group:completed fires exactly once, no duplicates
  it('emits group:completed exactly once with concurrent workers (VAL-05)', async () => {
    const groupNode = await flowProducer.addGroup({
      name: 'concurrent-test',
      queueName,
      jobs: [
        { name: 'job-a', queueName, data: {} },
        { name: 'job-b', queueName, data: {} },
        { name: 'job-c', queueName, data: {} },
      ],
    });

    let completedCount = 0;
    queueEvents.on('group:completed', () => {
      completedCount++;
    });

    // Three concurrent workers
    for (let i = 0; i < 3; i++) {
      workers.push(
        new Worker(queueName, async () => 'ok', { connection, prefix }),
      );
    }

    await delay(5000);

    const groupState = await queue.getGroupState(groupNode.groupId);
    expect(groupState!.state).toBe('COMPLETED');
    expect(completedCount).toBe(1);
  }, 30000);

  // VAL-13: getGroupState reflects partial completion
  it('getGroupState returns ACTIVE with correct completedCount during partial completion (VAL-13)', async () => {
    const groupNode = await flowProducer.addGroup({
      name: 'partial-test',
      queueName,
      jobs: [
        { name: 'job-a', queueName, data: {} },
        { name: 'job-b', queueName, data: {} },
        { name: 'job-c', queueName, data: {} },
      ],
    });

    let processedCount = 0;
    // Resolve when job 3 starts — by that point jobs 1 and 2 have both completed
    // and their group hooks have run (completedCount = 2). Block job 3 so the
    // group doesn't reach COMPLETED while we assert.
    const pauseAtThird = new Promise<void>(resolve => {
      const worker = new Worker(
        queueName,
        async () => {
          processedCount++;
          if (processedCount === 3) {
            resolve();
            await delay(5000); // Hold job 3 open so group stays ACTIVE
          }
          return 'done';
        },
        { connection, prefix, concurrency: 1 },
      );
      workers.push(worker);
    });

    await pauseAtThird;
    await delay(500); // Let the completedCount increments propagate

    const groupState = await queue.getGroupState(groupNode.groupId);
    expect(groupState!.state).toBe('ACTIVE');
    expect(groupState!.completedCount).toBe(2);
    expect(groupState!.totalJobs).toBe(3);
  }, 30000);

  // VAL-14: getGroupState returns null for non-existent group
  it('getGroupState returns null for a non-existent group ID (VAL-14)', async () => {
    const result = await queue.getGroupState('nonexistent-group-id');
    expect(result).toBeNull();
  });

  // VAL-15: getGroupJobs returns correct statuses
  it('getGroupJobs returns all entries with correct statuses (VAL-15)', async () => {
    const groupNode = await flowProducer.addGroup({
      name: 'jobs-query-test',
      queueName,
      jobs: [
        { name: 'job-a', queueName, data: {} },
        { name: 'job-b', queueName, data: {} },
      ],
    });

    // Check pending state before processing
    const jobsBefore = await queue.getGroupJobs(groupNode.groupId);
    expect(jobsBefore).toHaveLength(2);
    expect(jobsBefore.every(j => j.status === 'pending')).toBe(true);
    expect(jobsBefore.every(j => j.queueName === queueName)).toBe(true);
    expect(jobsBefore.every(j => j.jobId !== '')).toBe(true);
  });
});
