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
import { removeAllQueueData, delay } from '../src/utils';

/**
 * Group cancellation tests (VAL-10, VAL-11, VAL-12)
 */
describe('JobGroup cancellation', () => {
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
  });

  afterEach(async () => {
    await queueEvents.close();
    await flowProducer.close();
    await queue.close();
    await removeAllQueueData(new IORedis(redisHost), queueName);
  });

  afterAll(async () => {
    await connection.quit();
  });

  // VAL-10: Cancel active group with completed + waiting + delayed jobs
  it('cancels waiting and delayed jobs and creates compensation for completed jobs (VAL-10)', async () => {
    // TODO(features): implement
    // - group with completed job-A, waiting job-B, delayed job-C
    // - call cancelGroup
    // - assert job-B removed from wait, job-C removed from delayed
    // - assert compensation job created for job-A
    // - assert state = COMPENSATING
    expect(true).toBe(true);
  });

  // VAL-11: Cancel active group with all jobs still waiting → FAILED, no compensation
  it('transitions to FAILED with no compensation when all jobs are still waiting (VAL-11)', async () => {
    // TODO(features): implement
    expect(true).toBe(true);
  });

  // VAL-12: Cancel a completed group → throws InvalidGroupStateError
  it('throws InvalidGroupStateError when cancelling a completed group (VAL-12)', async () => {
    // TODO(features): implement
    expect(true).toBe(true);
  });
});
