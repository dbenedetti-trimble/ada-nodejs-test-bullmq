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

describe('JobGroup - Compensation', () => {
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

  // VAL-06: Failed job triggers compensation for completed siblings
  it.skip('should trigger compensation when a job fails', async () => {
    // TODO: implement in features pass
  });

  // VAL-07: No compensation when first job fails with no completed siblings
  it.skip('should transition to FAILED when no completed jobs to compensate', async () => {
    // TODO: implement in features pass
  });

  // VAL-08: Compensation jobs execute with retry
  it.skip('should retry compensation jobs and transition to FAILED', async () => {
    // TODO: implement in features pass
  });

  // VAL-09: Failed compensation transitions to FAILED_COMPENSATION
  it.skip('should transition to FAILED_COMPENSATION when compensation fails', async () => {
    // TODO: implement in features pass
  });

  // VAL-19: Compensation jobs include original return value
  it.skip('should include original return value in compensation job data', async () => {
    // TODO: implement in features pass
  });

  // VAL-20: Active jobs are not forcibly terminated during compensation
  it.skip('should not terminate active jobs during compensation', async () => {
    // TODO: implement in features pass
  });
});
