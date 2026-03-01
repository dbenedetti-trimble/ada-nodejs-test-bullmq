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
import {
  FlowProducer,
  Queue,
  Worker,
  QueueEvents,
} from '../src/classes';
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

  // VAL-13: getGroupState reflects partial completion
  it('getGroupState returns correct counts and state for a partially completed group', async () => {
    // TODO(features): implement
    // - group with 3 jobs, 2 completed, 1 still active
    // - assert state='ACTIVE', totalJobs=3, completedCount=2, failedCount=0, cancelledCount=0
    // - assert name, createdAt, updatedAt are present
  });

  // VAL-14: Non-existent group returns null
  it('getGroupState returns null for a non-existent group ID', async () => {
    // TODO(features): implement
    const state = await queue.getGroupState('nonexistent-id');
    expect(state).toBeNull();
  });

  // VAL-15: getGroupJobs returns correct statuses
  it('getGroupJobs returns all entries with correct status for each member job', async () => {
    // TODO(features): implement
    // - 3 jobs: 1 completed, 1 active, 1 pending
    // - assert array of 3 entries with jobId, jobKey, status, queueName
  });
});
