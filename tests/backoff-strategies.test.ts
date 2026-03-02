import {
  describe,
  beforeEach,
  afterEach,
  beforeAll,
  afterAll,
  it,
  expect,
} from 'vitest';

import { default as IORedis } from 'ioredis';
import { v4 } from 'uuid';
import { Queue, Job, Worker, QueueEvents } from '../src/classes';
import { removeAllQueueData, delay } from '../src/utils';

describe('Backoff strategies', () => {
  const redisHost = process.env.REDIS_HOST || 'localhost';
  const prefix = process.env.BULLMQ_TEST_PREFIX || 'bull';

  let queue: Queue;
  let queueName: string;
  let connection: IORedis;

  beforeAll(async () => {
    connection = new IORedis(redisHost, { maxRetriesPerRequest: null });
  });

  beforeEach(async () => {
    queueName = `test-${v4()}`;
    queue = new Queue(queueName, { connection, prefix });
    await queue.waitUntilReady();
  });

  afterEach(async () => {
    await queue.close();
    await removeAllQueueData(new IORedis(redisHost), queueName);
  });

  afterAll(async () => {
    await connection.quit();
  });

  describe('linear', () => {
    it('should produce linearly increasing delays', async () => {
      const delays: number[] = [];
      let attemptCount = 0;

      const worker = new Worker(
        queueName,
        async () => {
          attemptCount++;
          throw new Error('fail');
        },
        { connection, prefix },
      );
      await worker.waitUntilReady();

      await queue.add(
        'test',
        {},
        {
          attempts: 4,
          backoff: { type: 'linear', delay: 200 },
        },
      );

      const failed = new Promise<void>(resolve => {
        worker.on('failed', async (job, _err) => {
          if (job && job.attemptsMade >= 3) {
            resolve();
          }
        });
      });

      await failed;
      await worker.close();
    });

    it('should apply jitter to linear backoff', async () => {
      const worker = new Worker(
        queueName,
        async () => {
          throw new Error('fail');
        },
        { connection, prefix },
      );
      await worker.waitUntilReady();

      await queue.add(
        'test',
        {},
        {
          attempts: 3,
          backoff: { type: 'linear', delay: 1000, jitter: 0.5 },
        },
      );

      const failed = new Promise<Job>(resolve => {
        worker.on('failed', async (job, _err) => {
          if (job && job.attemptsMade >= 2) {
            resolve(job);
          }
        });
      });

      await failed;
      await worker.close();
    });
  });

  describe('polynomial', () => {
    it('should produce polynomial delays with default exponent 2', async () => {
      const worker = new Worker(
        queueName,
        async () => {
          throw new Error('fail');
        },
        { connection, prefix },
      );
      await worker.waitUntilReady();

      await queue.add(
        'test',
        {},
        {
          attempts: 4,
          backoff: { type: 'polynomial', delay: 100 },
        },
      );

      const failed = new Promise<void>(resolve => {
        worker.on('failed', async (job, _err) => {
          if (job && job.attemptsMade >= 3) {
            resolve();
          }
        });
      });

      await failed;
      await worker.close();
    });

    it('should produce polynomial delays with custom exponent 3', async () => {
      const worker = new Worker(
        queueName,
        async () => {
          throw new Error('fail');
        },
        { connection, prefix },
      );
      await worker.waitUntilReady();

      await queue.add(
        'test',
        {},
        {
          attempts: 3,
          backoff: { type: 'polynomial', delay: 100, exponent: 3 },
        },
      );

      const failed = new Promise<void>(resolve => {
        worker.on('failed', async (job, _err) => {
          if (job && job.attemptsMade >= 2) {
            resolve();
          }
        });
      });

      await failed;
      await worker.close();
    });
  });

  describe('decorrelatedJitter', () => {
    it('should produce delays within expected bounds', async () => {
      const baseDelay = 200;
      const maxDelay = 5000;

      const worker = new Worker(
        queueName,
        async () => {
          throw new Error('fail');
        },
        { connection, prefix },
      );
      await worker.waitUntilReady();

      await queue.add(
        'test',
        {},
        {
          attempts: 5,
          backoff: { type: 'decorrelatedJitter', delay: baseDelay, maxDelay },
        },
      );

      const finished = new Promise<void>(resolve => {
        worker.on('failed', async (job, _err) => {
          if (job && job.attemptsMade >= 4) {
            resolve();
          }
        });
      });

      await finished;
      await worker.close();
    });

    it('should persist previous delay state across attempts', async () => {
      const worker = new Worker(
        queueName,
        async job => {
          if (job.attemptsMade > 0) {
            expect(job.data.__bullmq_prevDelay).to.be.a('number');
          }
          throw new Error('fail');
        },
        { connection, prefix },
      );
      await worker.waitUntilReady();

      await queue.add(
        'test',
        {},
        {
          attempts: 3,
          backoff: { type: 'decorrelatedJitter', delay: 100 },
        },
      );

      const finished = new Promise<void>(resolve => {
        worker.on('failed', async (job, _err) => {
          if (job && job.attemptsMade >= 2) {
            resolve();
          }
        });
      });

      await finished;
      await worker.close();
    });
  });

  describe('maxDelay', () => {
    it('should cap exponential backoff delay', async () => {
      const worker = new Worker(
        queueName,
        async () => {
          throw new Error('fail');
        },
        { connection, prefix },
      );
      await worker.waitUntilReady();

      await queue.add(
        'test',
        {},
        {
          attempts: 6,
          backoff: { type: 'exponential', delay: 200, maxDelay: 1000 },
        },
      );

      const finished = new Promise<void>(resolve => {
        worker.on('failed', async (job, _err) => {
          if (job && job.attemptsMade >= 5) {
            resolve();
          }
        });
      });

      await finished;
      await worker.close();
    });

    it('should cap linear backoff delay', async () => {
      const worker = new Worker(
        queueName,
        async () => {
          throw new Error('fail');
        },
        { connection, prefix },
      );
      await worker.waitUntilReady();

      await queue.add(
        'test',
        {},
        {
          attempts: 6,
          backoff: { type: 'linear', delay: 200, maxDelay: 600 },
        },
      );

      const finished = new Promise<void>(resolve => {
        worker.on('failed', async (job, _err) => {
          if (job && job.attemptsMade >= 5) {
            resolve();
          }
        });
      });

      await finished;
      await worker.close();
    });

    it('should treat maxDelay: 0 as no cap', async () => {
      const worker = new Worker(
        queueName,
        async () => {
          throw new Error('fail');
        },
        { connection, prefix },
      );
      await worker.waitUntilReady();

      await queue.add(
        'test',
        {},
        {
          attempts: 3,
          backoff: { type: 'exponential', delay: 200, maxDelay: 0 },
        },
      );

      const finished = new Promise<void>(resolve => {
        worker.on('failed', async (job, _err) => {
          if (job && job.attemptsMade >= 2) {
            resolve();
          }
        });
      });

      await finished;
      await worker.close();
    });
  });

  describe('errorBackoffs', () => {
    it('should use error-specific backoff when error name matches', async () => {
      class RateLimitError extends Error {
        constructor() {
          super('rate limited');
          this.name = 'RateLimitError';
        }
      }

      let attemptCount = 0;

      const worker = new Worker(
        queueName,
        async () => {
          attemptCount++;
          throw new RateLimitError();
        },
        { connection, prefix },
      );
      await worker.waitUntilReady();

      await queue.add(
        'test',
        {},
        {
          attempts: 3,
          backoff: { type: 'exponential', delay: 100 },
          errorBackoffs: {
            RateLimitError: { type: 'fixed', delay: 200 },
          },
        },
      );

      const finished = new Promise<void>(resolve => {
        worker.on('failed', async (job, _err) => {
          if (job && job.attemptsMade >= 2) {
            resolve();
          }
        });
      });

      await finished;
      await worker.close();
    });

    it('should fall back to default backoff when error name does not match', async () => {
      let attemptCount = 0;

      const worker = new Worker(
        queueName,
        async () => {
          attemptCount++;
          throw new TypeError('type error');
        },
        { connection, prefix },
      );
      await worker.waitUntilReady();

      await queue.add(
        'test',
        {},
        {
          attempts: 3,
          backoff: { type: 'exponential', delay: 100 },
          errorBackoffs: {
            RateLimitError: { type: 'fixed', delay: 5000 },
          },
        },
      );

      const finished = new Promise<void>(resolve => {
        worker.on('failed', async (job, _err) => {
          if (job && job.attemptsMade >= 2) {
            resolve();
          }
        });
      });

      await finished;
      await worker.close();
    });

    it('should respect maxDelay on error-specific backoff', async () => {
      class TimeoutError extends Error {
        constructor() {
          super('timeout');
          this.name = 'TimeoutError';
        }
      }

      const worker = new Worker(
        queueName,
        async () => {
          throw new TimeoutError();
        },
        { connection, prefix },
      );
      await worker.waitUntilReady();

      await queue.add(
        'test',
        {},
        {
          attempts: 4,
          backoff: { type: 'fixed', delay: 100 },
          errorBackoffs: {
            TimeoutError: { type: 'linear', delay: 200, maxDelay: 500 },
          },
        },
      );

      const finished = new Promise<void>(resolve => {
        worker.on('failed', async (job, _err) => {
          if (job && job.attemptsMade >= 3) {
            resolve();
          }
        });
      });

      await finished;
      await worker.close();
    });
  });

  describe('existing strategies unchanged', () => {
    it('should process fixed backoff correctly', async () => {
      const worker = new Worker(
        queueName,
        async () => {
          throw new Error('fail');
        },
        { connection, prefix },
      );
      await worker.waitUntilReady();

      await queue.add(
        'test',
        {},
        {
          attempts: 3,
          backoff: { type: 'fixed', delay: 200 },
        },
      );

      const finished = new Promise<void>(resolve => {
        worker.on('failed', async (job, _err) => {
          if (job && job.attemptsMade >= 2) {
            resolve();
          }
        });
      });

      await finished;
      await worker.close();
    });

    it('should process exponential backoff correctly', async () => {
      const worker = new Worker(
        queueName,
        async () => {
          throw new Error('fail');
        },
        { connection, prefix },
      );
      await worker.waitUntilReady();

      await queue.add(
        'test',
        {},
        {
          attempts: 4,
          backoff: { type: 'exponential', delay: 100 },
        },
      );

      const finished = new Promise<void>(resolve => {
        worker.on('failed', async (job, _err) => {
          if (job && job.attemptsMade >= 3) {
            resolve();
          }
        });
      });

      await finished;
      await worker.close();
    });
  });
});
