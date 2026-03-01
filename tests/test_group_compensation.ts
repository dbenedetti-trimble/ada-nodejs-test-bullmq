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

describe('JobGroup - compensation', () => {
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

  // VAL-06: Two completed, one fails → COMPENSATING + compensation jobs created
  it('transitions to COMPENSATING when a job fails with completed siblings', async () => {
    // TODO(features): implement
    // - create group with 3 jobs and compensation mappings
    // - let job-A and job-B complete
    // - let job-C fail after all attempts
    // - assert group state is COMPENSATING
    // - assert compensation jobs exist in {queueName}:compensation queue
    // - assert compensation job data has originalReturnValue
    // - assert group:compensating event fires
  });

  // VAL-07: First job fails, no completed siblings → FAILED directly
  it('transitions directly to FAILED when first job fails with no completed siblings', async () => {
    // TODO(features): implement
  });

  // VAL-08: Compensation succeeds → FAILED
  it('transitions to FAILED when all compensation jobs succeed', async () => {
    // TODO(features): implement
  });

  // VAL-09: Compensation fails all attempts → FAILED_COMPENSATION
  it('transitions to FAILED_COMPENSATION when compensation job exhausts retries', async () => {
    // TODO(features): implement
  });

  // VAL-19: Original return value in compensation job data
  it('compensation job data includes originalReturnValue from the completed job', async () => {
    // TODO(features): implement
  });

  // VAL-20: Active jobs not forcibly terminated
  it('active jobs continue processing after compensation starts', async () => {
    // TODO(features): implement
    // - active job should not be killed
    // - its result does not change group state from COMPENSATING
  });
});
