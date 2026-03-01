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

describe('JobGroup - query API', () => {
  const redisHost = process.env.REDIS_HOST || 'localhost';
  const prefix = process.env.BULLMQ_TEST_PREFIX || 'bull';

  let connection: IORedis;
  let queue: Queue;
  let queueName: string;
  let flowProducer: FlowProducer;

  beforeAll(async () => {
    connection = new IORedis(redisHost, { maxRetriesPerRequest: null });
  });

  beforeEach(async () => {
    queueName = `test-${v4()}`;
    queue = new Queue(queueName, { connection, prefix });
    flowProducer = new FlowProducer({ connection, prefix });
  });

  afterEach(async () => {
    await queue.close();
    await flowProducer.close();
    await removeAllQueueData(new IORedis(redisHost), queueName);
  });

  afterAll(async () => {
    await connection.quit();
  });

  // VAL-14: Non-existent group returns null
  it('getGroupState returns null for a non-existent group ID', async () => {
    const state = await queue.getGroupState('nonexistent-id');
    expect(state).toBeNull();
  });

  // VAL-13: getGroupState reflects partial completion
  it('getGroupState returns correct counts and state after group creation', async () => {
    const groupNode = await flowProducer.addGroup({
      name: 'query-test',
      jobs: [
        { name: 'job-a', queueName, data: {} },
        { name: 'job-b', queueName, data: {} },
        { name: 'job-c', queueName, data: {} },
      ],
    });

    const state = await queue.getGroupState(groupNode.groupId);
    expect(state).not.toBeNull();
    expect(state!.id).toBe(groupNode.groupId);
    expect(state!.name).toBe('query-test');
    expect(state!.state).toBe('ACTIVE');
    expect(state!.totalJobs).toBe(3);
    expect(state!.completedCount).toBe(0);
    expect(state!.failedCount).toBe(0);
    expect(state!.cancelledCount).toBe(0);
    expect(state!.createdAt).toBeGreaterThan(0);
    expect(state!.updatedAt).toBeGreaterThan(0);
  });

  // VAL-15: getGroupJobs returns all entries with correct status
  it('getGroupJobs returns all member jobs with correct fields', async () => {
    const groupNode = await flowProducer.addGroup({
      name: 'jobs-test',
      jobs: [
        { name: 'job-a', queueName, data: {} },
        { name: 'job-b', queueName, data: {} },
        { name: 'job-c', queueName, data: {} },
      ],
    });

    const entries = await queue.getGroupJobs(groupNode.groupId);
    expect(entries).toHaveLength(3);

    for (const entry of entries) {
      expect(entry.jobId).toBeTruthy();
      expect(entry.jobKey).toContain(queueName);
      expect(entry.queueName).toBe(queueName);
      expect(entry.status).toBe('pending');
    }
  });

  // VAL-15: getGroupJobs returns empty array for non-existent group
  it('getGroupJobs returns empty array for non-existent group', async () => {
    const entries = await queue.getGroupJobs('nonexistent-id');
    expect(entries).toEqual([]);
  });

  // Check that state is updated after jobs complete
  it('getGroupState updates completedCount after jobs finish', async () => {
    const queueEvents = new QueueEvents(queueName, { connection, prefix });
    await queueEvents.waitUntilReady();

    const groupNode = await flowProducer.addGroup({
      name: 'count-test',
      jobs: [
        { name: 'job-a', queueName, data: {} },
        { name: 'job-b', queueName, data: {} },
      ],
    });

    const completedPromise = new Promise<void>(resolve => {
      queueEvents.on('group:completed' as any, () => resolve());
    });

    const worker = new Worker(queueName, async () => 'done', {
      connection,
      prefix,
    });
    await worker.waitUntilReady();

    await completedPromise;
    await worker.close();
    await queueEvents.close();

    const state = await queue.getGroupState(groupNode.groupId);
    expect(state!.state).toBe('COMPLETED');
    expect(state!.completedCount).toBe(2);
  }, 30000);
});
