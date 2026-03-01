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
import { removeAllQueueData } from '../src/utils';

describe('JobGroup - Compensation Flow (GRP-4, GRP-5)', () => {
  const redisHost = process.env.REDIS_HOST || 'localhost';
  const prefix = process.env.BULLMQ_TEST_PREFIX || 'bull';

  let flowProducer: FlowProducer;
  let queue: Queue;
  let worker: Worker;
  let queueEvents: QueueEvents;
  let queueName: string;
  let connection: IORedis;

  beforeAll(async () => {
    connection = new IORedis(redisHost, { maxRetriesPerRequest: null });
  });

  beforeEach(async () => {
    queueName = `test-${v4()}`;
    queue = new Queue(queueName, { connection, prefix });
    queueEvents = new QueueEvents(queueName, { connection, prefix });
    flowProducer = new FlowProducer({ connection, prefix });
    await queueEvents.waitUntilReady();
  });

  afterEach(async () => {
    await worker?.close();
    await flowProducer.close();
    await queueEvents.close();
    await queue.close();
    await removeAllQueueData(new IORedis(redisHost), queueName);
  });

  afterAll(async () => {
    await connection.quit();
  });

  // VAL-06
  it('should trigger compensation for completed sibling jobs when a job fails', async () => {
    // TODO(features): implement
  });

  // VAL-07
  it('should transition directly to FAILED when first job fails with no completed siblings', async () => {
    // TODO(features): implement
  });

  // VAL-08
  it('should transition to FAILED when all compensation jobs succeed', async () => {
    // TODO(features): implement
  });

  // VAL-09
  it('should transition to FAILED_COMPENSATION when a compensation job exhausts retries', async () => {
    // TODO(features): implement
  });

  // VAL-19
  it('should include original job return value in compensation job data', async () => {
    // TODO(features): implement
  });

  // VAL-20
  it('should not forcibly terminate active jobs during compensation', async () => {
    // TODO(features): implement
  });

  it('should emit group:compensating event with failedJobId and reason', async () => {
    // TODO(features): implement
  });

  it('should emit group:failed event with terminal state', async () => {
    // TODO(features): implement
  });
});
