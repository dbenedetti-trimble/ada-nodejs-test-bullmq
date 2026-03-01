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

describe('JobGroup - edge cases', () => {
  const redisHost = process.env.REDIS_HOST || 'localhost';
  const prefix = process.env.BULLMQ_TEST_PREFIX || 'bull';

  let connection: IORedis;
  let queue: Queue;
  let queueName: string;
  let flowProducer: FlowProducer;
  let queueEvents: QueueEvents;

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
    await queue.close();
    await flowProducer.close();
    await queueEvents.close();
    await removeAllQueueData(new IORedis(redisHost), queueName);
  });

  afterAll(async () => {
    await connection.quit();
  });

  // VAL-16: Delayed job in group removed from delayed sorted set
  it('delayed group job is removed from delayed set during compensation', async () => {
    // TODO(features): implement
    // - group with job-A (standard) and job-B (delay: 60000)
    // - job-A fails after all retries
    // - assert job-B removed from delayed set
    // - assert job-B status in group is 'cancelled'
    // - assert group's cancelledCount is 1
  });

  // VAL-17: Prioritized job in group removed from prioritized sorted set
  it('prioritized group job is removed from prioritized set during compensation', async () => {
    // TODO(features): implement
    // - group with job-A (standard) and job-B (priority: 5)
    // - job-A fails after all retries
    // - assert job-B removed from prioritized set
    // - assert job-B status in group is 'cancelled'
  });

  // VAL-05 concurrent variant: concurrent failures deduplicated
  it('concurrent job failures result in exactly one compensation cycle', async () => {
    // TODO(features): implement
    // - group with 3 jobs processed by separate workers
    // - two jobs fail near-simultaneously
    // - assert group transitions to COMPENSATING exactly once (no double-trigger)
    // - assert group:compensating event fires exactly once
  });
});
