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
import { Queue, Worker, FlowProducer } from '../src/classes';
import { removeAllQueueData, delay } from '../src/utils';

describe('JobGroup - Query API', () => {
  const redisHost = process.env.REDIS_HOST || 'localhost';
  const prefix = process.env.BULLMQ_TEST_PREFIX || 'bull';

  let queue: Queue;
  let queueName: string;
  let flowProducer: FlowProducer;
  let worker: Worker;
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
    if (worker) {
      await worker.close();
    }
    await flowProducer.close();
    await queue.close();
    await removeAllQueueData(new IORedis(redisHost), queueName);
  });

  afterAll(async () => {
    await connection.quit();
  });

  // VAL-13: Query group state
  it('should return group state with correct counts', async () => {
    const groupNode = await flowProducer.addGroup({
      name: 'query-group',
      jobs: [
        { name: 'job-a', queueName, data: { task: 'a' } },
        { name: 'job-b', queueName, data: { task: 'b' } },
        { name: 'job-c', queueName, data: { task: 'c' } },
      ],
    });

    const groupState = await queue.getGroupState(groupNode.groupId);
    expect(groupState).toBeDefined();
    expect(groupState!.id).toBe(groupNode.groupId);
    expect(groupState!.state).toBe('ACTIVE');
    expect(groupState!.totalJobs).toBe(3);
    expect(groupState!.completedCount).toBe(0);
    expect(groupState!.failedCount).toBe(0);
    expect(groupState!.cancelledCount).toBe(0);
    expect(groupState!.name).toBe('query-group');
    expect(groupState!.createdAt).toBeGreaterThan(0);
    expect(groupState!.updatedAt).toBeGreaterThan(0);
  });

  // VAL-14: Query group state for non-existent group
  it('should return null for non-existent group', async () => {
    const groupState = await queue.getGroupState('nonexistent-id');
    expect(groupState).toBeNull();
  });

  // VAL-15: Query group jobs
  it('should return all group jobs with their statuses', async () => {
    const groupNode = await flowProducer.addGroup({
      name: 'query-jobs-group',
      jobs: [
        { name: 'job-a', queueName, data: { task: 'a' } },
        { name: 'job-b', queueName, data: { task: 'b' } },
        { name: 'job-c', queueName, data: { task: 'c' } },
      ],
    });

    const groupJobs = await queue.getGroupJobs(groupNode.groupId);
    expect(groupJobs).toHaveLength(3);

    for (const job of groupJobs) {
      expect(job.jobId).toBeDefined();
      expect(job.jobKey).toBeDefined();
      expect(job.status).toBe('pending');
      expect(job.queueName).toBe(queueName);
    }
  });
});
