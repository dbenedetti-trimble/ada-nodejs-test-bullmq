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
import { Queue, QueueEvents, Worker, FlowProducer } from '../src/classes';
import { removeAllQueueData, delay } from '../src/utils';

describe('JobGroup - Cancellation', () => {
  const redisHost = process.env.REDIS_HOST || 'localhost';
  const prefix = process.env.BULLMQ_TEST_PREFIX || 'bull';

  let queue: Queue;
  let queueName: string;
  let flowProducer: FlowProducer;
  let worker: Worker;
  let queueEvents: QueueEvents;
  let connection: IORedis;

  beforeAll(async () => {
    connection = new IORedis(redisHost, { maxRetriesPerRequest: null });
  });

  beforeEach(async () => {
    queueName = `test-${v4()}`;
    queue = new Queue(queueName, { connection, prefix });
    flowProducer = new FlowProducer({ connection, prefix });
    queueEvents = new QueueEvents(queueName, { connection, prefix });
    await queueEvents.waitUntilReady();
  });

  afterEach(async () => {
    if (worker) {
      await worker.close();
    }
    await queueEvents.close();
    await flowProducer.close();
    await queue.close();
    await removeAllQueueData(new IORedis(redisHost), queueName);
  });

  afterAll(async () => {
    await connection.quit();
  });

  // VAL-10: Cancel an active group with completed jobs
  it.skip('should cancel active group and trigger compensation for completed jobs', async () => {
    // TODO: implement in features pass
  });

  // VAL-11: Cancel an active group with no completed jobs
  it.skip('should cancel active group and transition to FAILED when no compensation needed', async () => {
    // TODO: implement in features pass
  });

  // VAL-12: Cancel a completed group (negative path)
  it.skip('should throw error when cancelling a completed group', async () => {
    // TODO: implement in features pass
  });
});
