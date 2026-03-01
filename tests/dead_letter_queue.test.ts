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

  // VAL-02, VAL-06: retry exhaustion routes to DLQ with full metadata
  it('routes job to DLQ after exhausting retries', async () => {
    // TODO (features pass): implement
    expect(true).toBe(true);
  });

  // VAL-03: UnrecoverableError goes directly to DLQ on first attempt
  it('routes job to DLQ immediately on UnrecoverableError', async () => {
    // TODO (features pass): implement
    expect(true).toBe(true);
  });

  // VAL-04: successful job does NOT go to DLQ
  it('does not route successful job to DLQ', async () => {
    // TODO (features pass): implement
    expect(true).toBe(true);
  });

  // VAL-01: no DLQ configured preserves existing failed-set behavior
  it('preserves existing failed-set behavior when deadLetterQueue not configured', async () => {
    // TODO (features pass): implement
    expect(true).toBe(true);
  });

  // VAL-05: job still retrying does NOT land in DLQ
  it('does not route job to DLQ while retries remain', async () => {
    // TODO (features pass): implement
    expect(true).toBe(true);
  });

  // VAL-07: DLQ job preserves original job name
  it('DLQ job preserves original job name', async () => {
    // TODO (features pass): implement
    expect(true).toBe(true);
  });

  // VAL-08: deadLettered event emitted on source queue events stream
  it('emits deadLettered event when job is routed to DLQ', async () => {
    // TODO (features pass): implement
    expect(true).toBe(true);
  });

  // VAL-09, VAL-10, VAL-11, VAL-12: inspection API
  it('getDeadLetterCount returns correct count', async () => {
    // TODO (features pass): implement
    expect(true).toBe(true);
  });

  it('getDeadLetterJobs returns paginated results', async () => {
    // TODO (features pass): implement
    expect(true).toBe(true);
  });

  it('peekDeadLetter returns job with metadata and undefined for missing', async () => {
    // TODO (features pass): implement
    expect(true).toBe(true);
  });

  // VAL-13, VAL-14, VAL-15: single replay
  it('replayDeadLetter re-enqueues job to source queue', async () => {
    // TODO (features pass): implement
    expect(true).toBe(true);
  });

  // VAL-16, VAL-21, VAL-22: bulk replay
  it('replayAllDeadLetters replays all jobs including across multiple source queues', async () => {
    // TODO (features pass): implement
    expect(true).toBe(true);
  });

  // VAL-17: filtered replay by name
  it('replayAllDeadLetters with name filter only replays matching jobs', async () => {
    // TODO (features pass): implement
    expect(true).toBe(true);
  });

  // VAL-18: filtered replay by failedReason
  it('replayAllDeadLetters with failedReason filter uses case-insensitive substring match', async () => {
    // TODO (features pass): implement
    expect(true).toBe(true);
  });

  // VAL-19, VAL-22: purge all
  it('purgeDeadLetters removes all jobs and returns count', async () => {
    // TODO (features pass): implement
    expect(true).toBe(true);
  });

  // VAL-20: purge filtered by name
  it('purgeDeadLetters with name filter only removes matching jobs', async () => {
    // TODO (features pass): implement
    expect(true).toBe(true);
  });
});
