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
import { Queue, FlowProducer } from '../src/classes';
import { removeAllQueueData } from '../src/utils';

describe('JobGroup - Creation', () => {
  const redisHost = process.env.REDIS_HOST || 'localhost';
  const prefix = process.env.BULLMQ_TEST_PREFIX || 'bull';

  let queue: Queue;
  let queueName: string;
  let flowProducer: FlowProducer;
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

  // VAL-01: Create a job group (happy path)
  it.skip('should create a group with multiple jobs atomically', async () => {
    // TODO: implement in features pass
  });

  // VAL-02: Create a group with empty jobs array (negative path)
  it.skip('should throw error when creating group with empty jobs', async () => {
    // TODO: implement in features pass
  });

  // VAL-03: Create a group with mismatched compensation keys (negative path)
  it.skip('should throw error when compensation key does not match any job', async () => {
    // TODO: implement in features pass
  });

  // VAL-18: Job cannot belong to both a group and a flow
  it.skip('should throw error when job has opts.parent set', async () => {
    // TODO: implement in features pass
  });
});
