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
import { FlowProducer, Queue } from '../src/classes';
import { removeAllQueueData } from '../src/utils';

describe('JobGroup - Query API (GRP-6)', () => {
  const redisHost = process.env.REDIS_HOST || 'localhost';
  const prefix = process.env.BULLMQ_TEST_PREFIX || 'bull';

  let flowProducer: FlowProducer;
  let queue: Queue;
  let queueName: string;
  let connection: IORedis;

  beforeAll(async () => {
    connection = new IORedis(redisHost, { maxRetriesPerRequest: null });
  });

  beforeEach(async () => {
    queueName = `test-${v4()}`;
    queue = new Queue(queueName, { connection, prefix });
    flowProducer = new FlowProducer({ connection, prefix });
  });

  afterEach(async () => {
    await flowProducer.close();
    await queue.close();
    await removeAllQueueData(new IORedis(redisHost), queueName);
  });

  afterAll(async () => {
    await connection.quit();
  });

  // VAL-13
  it('should return current group state with accurate counters', async () => {
    const groupNode = await flowProducer.addGroup({
      name: 'query-state-group',
      jobs: [
        { name: 'job-a', queueName, data: {} },
        { name: 'job-b', queueName, data: {} },
        { name: 'job-c', queueName, data: {} },
      ],
    });

    const state = await queue.getGroupState(groupNode.groupId);
    expect(state).not.toBeNull();
    expect(state!.id).toBe(groupNode.groupId);
    expect(state!.name).toBe('query-state-group');
    expect(state!.state).toBe('ACTIVE');
    expect(state!.totalJobs).toBe(3);
    expect(state!.completedCount).toBe(0);
    expect(state!.failedCount).toBe(0);
    expect(state!.cancelledCount).toBe(0);
    expect(state!.createdAt).toBeGreaterThan(0);
    expect(state!.updatedAt).toBeGreaterThan(0);
  });

  // VAL-14
  it('should return null for a non-existent group ID', async () => {
    const state = await queue.getGroupState('nonexistent-group-id');
    expect(state).toBeNull();
  });

  // VAL-15
  it('should return all group jobs with their statuses', async () => {
    const groupNode = await flowProducer.addGroup({
      name: 'query-jobs-group',
      jobs: [
        { name: 'job-a', queueName, data: {} },
        { name: 'job-b', queueName, data: {} },
      ],
    });

    const jobs = await queue.getGroupJobs(groupNode.groupId);
    expect(jobs).toHaveLength(2);
    for (const job of jobs) {
      expect(job.jobId).toBeTruthy();
      expect(job.jobKey).toBeTruthy();
      expect(job.status).toBe('pending');
      expect(job.queueName).toBeTruthy();
    }
  });

  it('should include queueName on each GroupJobEntry', async () => {
    const groupNode = await flowProducer.addGroup({
      name: 'queue-name-group',
      jobs: [{ name: 'job-a', queueName, data: {} }],
    });

    const jobs = await queue.getGroupJobs(groupNode.groupId);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].queueName).toBe(queueName);
  });

  it('should return cross-queue group jobs via getGroupJobs', async () => {
    const queueName2 = `test-${v4()}`;
    const queue2 = new Queue(queueName2, { connection, prefix });

    try {
      const groupNode = await flowProducer.addGroup({
        name: 'cross-queue-query-group',
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
});
