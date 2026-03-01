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
import { InvalidGroupStateError } from '../src/classes/errors/group-error';
import { removeAllQueueData, delay } from '../src/utils';

describe('JobGroup - cancellation', () => {
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

  // VAL-10: Cancel with completed + waiting + delayed jobs
  it('cancelGroup removes waiting/delayed jobs and creates compensation for completed jobs', async () => {
    // TODO(features): implement
    // - create group with 3 jobs: one completed, one waiting, one delayed
    // - call queue.cancelGroup(groupId)
    // - assert waiting job removed from wait list
    // - assert delayed job removed from delayed set
    // - assert compensation job created for completed job
    // - assert group state is COMPENSATING
  });

  // VAL-11: Cancel with all jobs waiting → FAILED, no compensation
  it('cancelGroup transitions to FAILED when no jobs have completed', async () => {
    // TODO(features): implement
    // - all 3 jobs still waiting
    // - cancelGroup transitions to FAILED
    // - no compensation jobs created
  });

  // VAL-12: Cancel completed group → InvalidGroupStateError
  it('throws InvalidGroupStateError when cancelling a completed group', async () => {
    // TODO(features): implement
    // - set up group in COMPLETED state
    // - assert cancelGroup throws InvalidGroupStateError
  });
});
