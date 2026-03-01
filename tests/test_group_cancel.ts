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

describe('JobGroup - Manual Cancellation (GRP-6 cancelGroup)', () => {
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

  // VAL-10
  it('should cancel pending jobs and trigger compensation for completed jobs', async () => {
    // TODO(features): implement
  });

  // VAL-11
  it('should transition to FAILED directly when no jobs have completed', async () => {
    // TODO(features): implement
  });

  // VAL-12
  it('should throw InvalidGroupStateError when cancelling a COMPLETED group', async () => {
    // TODO(features): implement
  });

  it('should throw InvalidGroupStateError when cancelling a COMPENSATING group', async () => {
    // TODO(features): implement
  });

  it('should remove delayed jobs from the delayed set during cancellation', async () => {
    // TODO(features): implement
  });
});
