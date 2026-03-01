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

/**
 * Group creation tests (VAL-01, VAL-02, VAL-03, VAL-18)
 */
describe('JobGroup creation', () => {
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
    await flowProducer.close();
    await queue.close();
    await removeAllQueueData(new IORedis(redisHost), queueName);
  });

  afterAll(async () => {
    await connection.quit();
  });

  // VAL-01: Happy path — addGroup returns GroupNode with groupId and job instances
  it('creates a group and returns a GroupNode with groupId and jobs (VAL-01)', async () => {
    // TODO(features): implement
    expect(true).toBe(true);
  });

  // VAL-01: Redis hash exists with state ACTIVE and correct totalJobs
  it('stores group metadata in Redis with state ACTIVE (VAL-01)', async () => {
    // TODO(features): implement
    expect(true).toBe(true);
  });

  // VAL-01: Each job carries opts.group.id matching the groupId
  it('attaches group.id to each job opts (VAL-01)', async () => {
    // TODO(features): implement
    expect(true).toBe(true);
  });

  // VAL-01: Compensation mapping is stored in group metadata
  it('stores compensation mapping in Redis (VAL-01)', async () => {
    // TODO(features): implement
    expect(true).toBe(true);
  });

  // VAL-02: Empty jobs array throws before any Redis write
  it('throws when jobs array is empty (VAL-02)', async () => {
    // TODO(features): implement
    expect(true).toBe(true);
  });

  // VAL-03: Mismatched compensation key throws; no Redis keys created
  it('throws when compensation key does not match any job name (VAL-03)', async () => {
    // TODO(features): implement
    expect(true).toBe(true);
  });

  // VAL-18: Job with opts.parent set throws validation error
  it('throws when a job has opts.parent (cannot belong to both group and flow) (VAL-18)', async () => {
    // TODO(features): implement
    expect(true).toBe(true);
  });
});
