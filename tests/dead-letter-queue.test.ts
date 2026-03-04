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
  Queue,
  QueueEvents,
  Job,
  UnrecoverableError,
  Worker,
} from '../src/classes';
import { delay, removeAllQueueData } from '../src/utils';

describe('Dead Letter Queue', () => {
  const redisHost = process.env.REDIS_HOST || 'localhost';
  const prefix = process.env.BULLMQ_TEST_PREFIX || 'bull';

  let queue: Queue;
  let dlqQueue: Queue;
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
  });

  afterEach(async () => {
    await queue.close();
    await dlqQueue.close();
    await removeAllQueueData(new IORedis(redisHost), queueName);
    await removeAllQueueData(new IORedis(redisHost), dlqQueueName);
  });

  afterAll(async () => {
    await connection.quit();
  });

  describe('DLQ-1: Worker dead letter queue configuration', () => {
    it('should accept deadLetterQueue option with a queueName string', async () => {
      // TODO: Implement in features pass
      const worker = new Worker(queueName, async () => {}, {
        connection,
        prefix,
        deadLetterQueue: { queueName: dlqQueueName },
      });

      expect(worker.opts.deadLetterQueue).toEqual({
        queueName: dlqQueueName,
      });

      await worker.close();
    });

    it('should throw if deadLetterQueue.queueName is empty', () => {
      // TODO: Implement in features pass
      expect(() => {
        new Worker(queueName, async () => {}, {
          connection,
          prefix,
          deadLetterQueue: { queueName: '' },
        });
      }).toThrow('deadLetterQueue.queueName must be a non-empty string');
    });

    it('should preserve current failure behavior when deadLetterQueue is not configured', async () => {
      // TODO: Implement in features pass
    });
  });

  describe('DLQ-2: Atomic job movement to DLQ on terminal failure', () => {
    it('should move job to DLQ after exhausting retries', async () => {
      // TODO: Implement in features pass
    });

    it('should move job to DLQ immediately on UnrecoverableError', async () => {
      // TODO: Implement in features pass
    });

    it('should NOT move job to DLQ if it succeeds before exhausting retries', async () => {
      // TODO: Implement in features pass
    });

    it('should emit deadLettered event on source queue events stream', async () => {
      // TODO: Implement in features pass
    });
  });

  describe('DLQ-3: DLQ job metadata', () => {
    it('should preserve original job data and add _dlqMeta', async () => {
      // TODO: Implement in features pass
    });

    it('should include complete failure context in _dlqMeta', async () => {
      // TODO: Implement in features pass
    });

    it('should preserve original job name on DLQ job', async () => {
      // TODO: Implement in features pass
    });
  });

  describe('DLQ-4: DLQ inspection API', () => {
    it('should return correct count via getDeadLetterCount()', async () => {
      // TODO: Implement in features pass
    });

    it('should return paginated results via getDeadLetterJobs()', async () => {
      // TODO: Implement in features pass
    });

    it('should return job with metadata via peekDeadLetter()', async () => {
      // TODO: Implement in features pass
    });

    it('should return undefined for non-existent job via peekDeadLetter()', async () => {
      // TODO: Implement in features pass
    });
  });

  describe('DLQ-5: Replay from DLQ', () => {
    it('should replay a dead-lettered job back to source queue', async () => {
      // TODO: Implement in features pass
    });

    it('should return a new job ID different from the original', async () => {
      // TODO: Implement in features pass
    });

    it('should throw for non-existent job ID', async () => {
      // TODO: Implement in features pass
    });

    it('should throw if source queue cannot be determined', async () => {
      // TODO: Implement in features pass
    });
  });

  describe('DLQ-6: Bulk replay and purge', () => {
    it('should replay all dead-lettered jobs', async () => {
      // TODO: Implement in features pass
    });

    it('should replay only jobs matching name filter', async () => {
      // TODO: Implement in features pass
    });

    it('should replay only jobs matching failedReason filter', async () => {
      // TODO: Implement in features pass
    });

    it('should purge all dead-lettered jobs', async () => {
      // TODO: Implement in features pass
    });

    it('should purge only jobs matching filter', async () => {
      // TODO: Implement in features pass
    });

    it('should return 0 for empty DLQ', async () => {
      // TODO: Implement in features pass
    });

    it('should handle bulk replay with multiple source queues', async () => {
      // TODO: Implement in features pass
    });
  });
});
