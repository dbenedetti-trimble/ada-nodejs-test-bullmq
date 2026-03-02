import { default as IORedis } from 'ioredis';
import { v4 } from 'uuid';
import {
  describe,
  beforeEach,
  afterEach,
  beforeAll,
  afterAll,
  it,
  expect,
} from 'vitest';

import { Queue, QueueEvents, Worker } from '../src/classes';
import { delay, removeAllQueueData } from '../src/utils';

describe('dead letter queue', () => {
  const redisHost = process.env.REDIS_HOST || 'localhost';
  const prefix = process.env.BULLMQ_TEST_PREFIX || 'bull';

  let queue: Queue;
  let dlqQueue: Queue;
  let queueEvents: QueueEvents;
  let queueName: string;
  let dlqQueueName: string;

  let connection: IORedis;
  beforeAll(async () => {
    connection = new IORedis(redisHost, { maxRetriesPerRequest: null });
  });

  beforeEach(async () => {
    queueName = `test-${v4()}`;
    dlqQueueName = `${queueName}-dlq`;
    queue = new Queue(queueName, { connection, prefix });
    dlqQueue = new Queue(dlqQueueName, { connection, prefix });
    queueEvents = new QueueEvents(queueName, { connection, prefix });
    await queue.waitUntilReady();
    await dlqQueue.waitUntilReady();
    await queueEvents.waitUntilReady();
  });

  afterEach(async () => {
    await queue.close();
    await dlqQueue.close();
    await queueEvents.close();
    await removeAllQueueData(new IORedis(redisHost), queueName);
    await removeAllQueueData(new IORedis(redisHost), dlqQueueName);
  });

  afterAll(async () => {
    await connection.quit();
  });

  describe('Worker configuration (DLQ-1)', () => {
    it('VAL-01: no DLQ config - failure behavior unchanged', async () => {
      // TODO: Implement in features pass
    });

    it('should validate that queueName is a non-empty string', () => {
      expect(() => {
        new Worker(queueName, async () => {}, {
          connection,
          prefix,
          deadLetterQueue: { queueName: '' },
        });
      }).toThrow('deadLetterQueue.queueName must be a non-empty string');
    });
  });

  describe('Atomic DLQ movement (DLQ-2)', () => {
    it('VAL-02: job routed to DLQ after exhausting retries', async () => {
      // TODO: Implement in features pass
    });

    it('VAL-03: UnrecoverableError goes directly to DLQ', async () => {
      // TODO: Implement in features pass
    });

    it('VAL-04: successful job does not go to DLQ', async () => {
      // TODO: Implement in features pass
    });

    it('VAL-05: retried job does not go to DLQ until retries exhausted', async () => {
      // TODO: Implement in features pass
    });
  });

  describe('DLQ metadata (DLQ-3)', () => {
    it('VAL-06: DLQ metadata is complete', async () => {
      // TODO: Implement in features pass
    });

    it('VAL-07: DLQ job preserves original job name', async () => {
      // TODO: Implement in features pass
    });
  });

  describe('Events (DLQ-2)', () => {
    it('VAL-08: deadLettered event emitted', async () => {
      // TODO: Implement in features pass
    });
  });

  describe('DLQ inspection API (DLQ-4)', () => {
    it('VAL-09: getDeadLetterCount returns correct count', async () => {
      // TODO: Implement in features pass
    });

    it('VAL-10: getDeadLetterJobs returns paginated results', async () => {
      // TODO: Implement in features pass
    });

    it('VAL-11: peekDeadLetter returns job with metadata', async () => {
      // TODO: Implement in features pass
    });

    it('VAL-12: peekDeadLetter returns undefined for missing job', async () => {
      const job = await dlqQueue.peekDeadLetter('nonexistent');
      expect(job).toBeUndefined();
    });
  });

  describe('Replay from DLQ (DLQ-5)', () => {
    it('VAL-13: replayDeadLetter re-enqueues to source queue', async () => {
      // TODO: Implement in features pass
    });

    it('VAL-14: replayDeadLetter returns new job ID', async () => {
      // TODO: Implement in features pass
    });

    it('VAL-15: replayDeadLetter throws for non-existent job', async () => {
      // TODO: Implement in features pass
    });
  });

  describe('Bulk replay and purge (DLQ-6)', () => {
    it('VAL-16: replayAllDeadLetters replays all jobs', async () => {
      // TODO: Implement in features pass
    });

    it('VAL-17: replayAllDeadLetters with name filter', async () => {
      // TODO: Implement in features pass
    });

    it('VAL-18: replayAllDeadLetters with failedReason filter', async () => {
      // TODO: Implement in features pass
    });

    it('VAL-19: purgeDeadLetters removes all', async () => {
      // TODO: Implement in features pass
    });

    it('VAL-20: purgeDeadLetters with filter', async () => {
      // TODO: Implement in features pass
    });

    it('VAL-21: bulk replay handles multiple source queues', async () => {
      // TODO: Implement in features pass
    });
  });

  describe('Edge cases', () => {
    it('VAL-22: empty DLQ operations return zero', async () => {
      const count = await dlqQueue.getDeadLetterCount();
      expect(count).toBe(0);

      const replayCount = await dlqQueue.replayAllDeadLetters();
      expect(replayCount).toBe(0);

      const purgeCount = await dlqQueue.purgeDeadLetters();
      expect(purgeCount).toBe(0);
    });
  });
});
