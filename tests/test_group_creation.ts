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

describe('JobGroup - Creation (GRP-1)', () => {
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

  // VAL-01
  it('should create a job group atomically and return a GroupNode', async () => {
    // TODO(features): implement
  });

  // VAL-02
  it('should throw an error when jobs array is empty', async () => {
    // TODO(features): implement
  });

  // VAL-03
  it('should throw an error when compensation references an unknown job name', async () => {
    // TODO(features): implement
  });

  // VAL-18
  it('should throw an error when a job has both opts.parent and group membership', async () => {
    // TODO(features): implement
  });

  it('should store compensation mapping in group metadata', async () => {
    // TODO(features): implement
  });

  it('should inject group.id into each member job opts', async () => {
    // TODO(features): implement
  });

  it('should support jobs targeting different queue names', async () => {
    // TODO(features): implement
  });
});
