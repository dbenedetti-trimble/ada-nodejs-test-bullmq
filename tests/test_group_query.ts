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
    // TODO(features): implement
  });

  // VAL-14
  it('should return null for a non-existent group ID', async () => {
    // TODO(features): implement
  });

  // VAL-15
  it('should return all group jobs with their statuses', async () => {
    // TODO(features): implement
  });

  it('should include queueName on each GroupJobEntry', async () => {
    // TODO(features): implement
  });

  it('should return cross-queue group jobs via getGroupJobs', async () => {
    // TODO(features): implement
  });
});
