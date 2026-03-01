import { default as IORedis } from 'ioredis';
import {
  describe,
  beforeAll,
  beforeEach,
  afterEach,
  afterAll,
  it,
  expect,
} from 'vitest';
import { v4 } from 'uuid';
import { Queue, Worker, QueueEvents, UnrecoverableError } from '../src/classes';
import { removeAllQueueData } from '../src/utils';

describe('Dead Letter Queue', () => {
  const redisHost = process.env.REDIS_HOST || 'localhost';
  const prefix = process.env.BULLMQ_TEST_PREFIX || 'bull';
  let connection: IORedis;
  let queue: Queue;
  let dlqQueue: Queue;
  let queueName: string;
  let dlqName: string;

  beforeAll(async () => {
    connection = new IORedis(redisHost, { maxRetriesPerRequest: null });
  });

  beforeEach(async () => {
    queueName = `test-${v4()}`;
    dlqName = `${queueName}-dlq`;
    queue = new Queue(queueName, { connection, prefix });
    dlqQueue = new Queue(dlqName, { connection, prefix });
  });

  afterEach(async () => {
    await queue.close();
    await dlqQueue.close();
    await removeAllQueueData(new IORedis(redisHost), queueName);
    await removeAllQueueData(new IORedis(redisHost), dlqName);
  });

  afterAll(async () => {
    await connection.quit();
  });

  // VAL-01: No DLQ configured — existing failed-set behavior unchanged
  it.todo('preserves existing failed-set behavior when deadLetterQueue not configured');

  // VAL-02, VAL-06: Job routed to DLQ after exhausting retries + full metadata
  it.todo('routes job to DLQ after exhausting retries with full _dlqMeta');

  // VAL-03: UnrecoverableError goes directly to DLQ on first attempt
  it.todo('routes job to DLQ immediately on UnrecoverableError');

  // VAL-04: Successful job does NOT go to DLQ
  it.todo('does not route successful job to DLQ');

  // VAL-05: Retried job does not go to DLQ until retries exhausted
  it.todo('does not route job to DLQ while retries remain');

  // VAL-07: DLQ job preserves original job name
  it.todo('DLQ job preserves original job name');

  // VAL-08: deadLettered event emitted on source queue events stream
  it.todo('emits deadLettered event when job is routed to DLQ');

  // VAL-09, VAL-10, VAL-11, VAL-12: Inspection API
  it.todo('getDeadLetterCount returns correct count');
  it.todo('getDeadLetterJobs returns paginated results');
  it.todo('peekDeadLetter returns job with _dlqMeta');
  it.todo('peekDeadLetter returns undefined for non-existent job');

  // VAL-13, VAL-14, VAL-15: Single replay
  it.todo('replayDeadLetter re-enqueues job to source queue');
  it.todo('replayDeadLetter returns new job ID different from original');
  it.todo('replayDeadLetter throws for non-existent job ID');

  // VAL-16, VAL-21, VAL-22: Bulk replay
  it.todo('replayAllDeadLetters replays all jobs including across multiple source queues');
  it.todo('empty DLQ returns 0 for replayAllDeadLetters');

  // VAL-17: Bulk replay with name filter
  it.todo('replayAllDeadLetters with name filter only replays matching jobs');

  // VAL-18: Bulk replay with failedReason filter (case-insensitive substring)
  it.todo('replayAllDeadLetters with failedReason filter uses case-insensitive substring match');

  // VAL-19, VAL-22: Purge all
  it.todo('purgeDeadLetters removes all jobs and returns count');
  it.todo('empty DLQ returns 0 for purgeDeadLetters');

  // VAL-20: Purge with name filter
  it.todo('purgeDeadLetters with name filter only removes matching jobs');

  // Worker construction validation
  it('throws when deadLetterQueue.queueName is empty', () => {
    expect(
      () =>
        new Worker(
          queueName,
          async () => {},
          {
            connection,
            prefix,
            deadLetterQueue: { queueName: '' },
          },
        ),
    ).toThrow('deadLetterQueue.queueName must be a non-empty string');
  });
});
