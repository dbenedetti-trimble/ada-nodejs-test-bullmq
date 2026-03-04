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

  afterAll(async function () {
    await connection.quit();
  });

  describe('linear', () => {
    it('should produce linearly increasing delays', async () => {
      const worker = new Worker(
        queueName,
        async () => {
          throw new Error('error');
        },
        { autorun: false, connection, prefix },
      );
      await worker.waitUntilReady();

      await queue.add(
        'test',
        { foo: 'bar' },
        {
          attempts: 4,
          backoff: {
            type: 'linear',
            delay: 1000,
          },
        },
      );

      const delays: number[] = [];

      const done = new Promise<void>((resolve, reject) => {
        worker.on('failed', async job => {
          try {
            if (job.attemptsMade < 4) {
              delays.push(job.delay);
            }
            if (job.attemptsMade >= 3) {
              expect(delays[0]).toEqual(1000);
              expect(delays[1]).toEqual(2000);
              expect(delays[2]).toEqual(3000);
              resolve();
            }
          } catch (err) {
            reject(err);
          }
        });
      });

      worker.run();
      await done;
      await worker.close();
    });

    it('should apply jitter within expected range', async () => {
      const worker = new Worker(
        queueName,
        async () => {
          throw new Error('error');
        },
        { autorun: false, connection, prefix },
      );
      await worker.waitUntilReady();

      await queue.add(
        'test',
        { foo: 'bar' },
        {
          attempts: 3,
          backoff: {
            type: 'linear',
            delay: 1000,
            jitter: 0.5,
          },
        },
      );

      const done = new Promise<void>((resolve, reject) => {
        worker.on('failed', async job => {
          try {
            if (job.attemptsMade < 3) {
              const rawDelay = 1000 * job.attemptsMade;
              const minDelay = rawDelay * (1 - 0.5);
              expect(job.delay).toBeGreaterThanOrEqual(minDelay);
              expect(job.delay).toBeLessThanOrEqual(rawDelay);
            }
            if (job.attemptsMade >= 2) {
              resolve();
            }
          } catch (err) {
            reject(err);
          }
        });
      });

      worker.run();
      await done;
      await worker.close();
    });
  });

  describe('polynomial', () => {
    it('should produce quadratic delays with default exponent', async () => {
      const worker = new Worker(
        queueName,
        async () => {
          throw new Error('error');
        },
        { autorun: false, connection, prefix },
      );
      await worker.waitUntilReady();

      await queue.add(
        'test',
        { foo: 'bar' },
        {
          attempts: 4,
          backoff: {
            type: 'polynomial',
            delay: 500,
          },
        },
      );

      const delays: number[] = [];

      const done = new Promise<void>((resolve, reject) => {
        worker.on('failed', async job => {
          try {
            if (job.attemptsMade < 4) {
              delays.push(job.delay);
            }
            if (job.attemptsMade >= 3) {
              expect(delays[0]).toEqual(500);
              expect(delays[1]).toEqual(2000);
              expect(delays[2]).toEqual(4500);
              resolve();
            }
          } catch (err) {
            reject(err);
          }
        });
      });

      worker.run();
      await done;
      await worker.close();
    });

    it('should produce cubic delays with exponent 3', async () => {
      const worker = new Worker(
        queueName,
        async () => {
          throw new Error('error');
        },
        { autorun: false, connection, prefix },
      );
      await worker.waitUntilReady();

      await queue.add(
        'test',
        { foo: 'bar' },
        {
          attempts: 3,
          backoff: {
            type: 'polynomial',
            delay: 100,
            exponent: 3,
          },
        },
      );

      const delays: number[] = [];

      const done = new Promise<void>((resolve, reject) => {
        worker.on('failed', async job => {
          try {
            if (job.attemptsMade < 3) {
              delays.push(job.delay);
            }
            if (job.attemptsMade >= 2) {
              expect(delays[0]).toEqual(100);
              expect(delays[1]).toEqual(800);
              resolve();
            }
          } catch (err) {
            reject(err);
          }
        });
      });

      worker.run();
      await done;
      await worker.close();
    });

    it('should apply jitter within expected range', async () => {
      const worker = new Worker(
        queueName,
        async () => {
          throw new Error('error');
        },
        { autorun: false, connection, prefix },
      );
      await worker.waitUntilReady();

      await queue.add(
        'test',
        { foo: 'bar' },
        {
          attempts: 3,
          backoff: {
            type: 'polynomial',
            delay: 1000,
            jitter: 0.25,
          },
        },
      );

      const done = new Promise<void>((resolve, reject) => {
        worker.on('failed', async job => {
          try {
            if (job.attemptsMade < 3) {
              const rawDelay = 1000 * Math.pow(job.attemptsMade, 2);
              const minDelay = rawDelay * (1 - 0.25);
              expect(job.delay).toBeGreaterThanOrEqual(minDelay);
              expect(job.delay).toBeLessThanOrEqual(rawDelay);
            }
            if (job.attemptsMade >= 2) {
              resolve();
            }
          } catch (err) {
            reject(err);
          }
        });
      });

      worker.run();
      await done;
      await worker.close();
    });
  });

  describe('decorrelatedJitter', () => {
    it('should produce delays within bounded range', async () => {
      const worker = new Worker(
        queueName,
        async () => {
          throw new Error('error');
        },
        { autorun: false, connection, prefix },
      );
      await worker.waitUntilReady();

      await queue.add(
        'test',
        { foo: 'bar' },
        {
          attempts: 6,
          backoff: {
            type: 'decorrelatedJitter',
            delay: 1000,
            maxDelay: 30000,
          },
        },
      );

      const delays: number[] = [];

      const done = new Promise<void>((resolve, reject) => {
        worker.on('failed', async job => {
          try {
            if (job.attemptsMade < 6) {
              delays.push(job.delay);
              expect(job.delay).toBeGreaterThanOrEqual(1000);
              expect(job.delay).toBeLessThanOrEqual(30000);
            }
            if (job.attemptsMade >= 5) {
              expect(delays.length).toBe(5);
              resolve();
            }
          } catch (err) {
            reject(err);
          }
        });
      });

      worker.run();
      await done;
      await worker.close();
    });

    it('should respect maxDelay cap', async () => {
      const worker = new Worker(
        queueName,
        async () => {
          throw new Error('error');
        },
        { autorun: false, connection, prefix },
      );
      await worker.waitUntilReady();

      await queue.add(
        'test',
        { foo: 'bar' },
        {
          attempts: 4,
          backoff: {
            type: 'decorrelatedJitter',
            delay: 1000,
            maxDelay: 2000,
          },
        },
      );

      const done = new Promise<void>((resolve, reject) => {
        worker.on('failed', async job => {
          try {
            if (job.attemptsMade < 4) {
              expect(job.delay).toBeLessThanOrEqual(2000);
              expect(job.delay).toBeGreaterThanOrEqual(1000);
            }
            if (job.attemptsMade >= 3) {
              resolve();
            }
          } catch (err) {
            reject(err);
          }
        });
      });

      worker.run();
      await done;
      await worker.close();
    });

    it('should produce non-deterministic delays', async () => {
      const worker = new Worker(
        queueName,
        async () => {
          throw new Error('error');
        },
        { autorun: false, connection, prefix },
      );
      await worker.waitUntilReady();

      await queue.add(
        'test',
        { foo: 'bar' },
        {
          attempts: 5,
          backoff: {
            type: 'decorrelatedJitter',
            delay: 100,
            maxDelay: 50000,
          },
        },
      );

      const delays: number[] = [];

      const done = new Promise<void>((resolve, reject) => {
        worker.on('failed', async job => {
          try {
            if (job.attemptsMade < 5) {
              delays.push(job.delay);
            }
            if (job.attemptsMade >= 4) {
              const allSame = delays.every(d => d === delays[0]);
              expect(allSame).toBe(false);
              resolve();
            }
          } catch (err) {
            reject(err);
          }
        });
      });

      worker.run();
      await done;
      await worker.close();
    });
  });

  describe('maxDelay', () => {
    it('should cap exponential backoff delay', async () => {
      const worker = new Worker(
        queueName,
        async () => {
          throw new Error('error');
        },
        { autorun: false, connection, prefix },
      );
      await worker.waitUntilReady();

      await queue.add(
        'test',
        { foo: 'bar' },
        {
          attempts: 6,
          backoff: {
            type: 'exponential',
            delay: 100,
            maxDelay: 500,
          },
        },
      );

      const done = new Promise<void>((resolve, reject) => {
        worker.on('failed', async job => {
          try {
            if (job.attemptsMade < 6) {
              expect(job.delay).toBeLessThanOrEqual(500);
            }
            if (job.attemptsMade >= 4) {
              expect(job.delay).toEqual(500);
              resolve();
            }
          } catch (err) {
            reject(err);
          }
        });
      });

      worker.run();
      await done;
      await worker.close();
    });

    it('should cap linear backoff delay', async () => {
      const worker = new Worker(
        queueName,
        async () => {
          throw new Error('error');
        },
        { autorun: false, connection, prefix },
      );
      await worker.waitUntilReady();

      await queue.add(
        'test',
        { foo: 'bar' },
        {
          attempts: 6,
          backoff: {
            type: 'linear',
            delay: 200,
            maxDelay: 500,
          },
        },
      );

      const done = new Promise<void>((resolve, reject) => {
        worker.on('failed', async job => {
          try {
            if (job.attemptsMade < 6) {
              expect(job.delay).toBeLessThanOrEqual(500);
            }
            if (job.attemptsMade >= 3) {
              expect(job.delay).toEqual(500);
              resolve();
            }
          } catch (err) {
            reject(err);
          }
        });
      });

      worker.run();
      await done;
      await worker.close();
    });

    it('should pass through delays below the cap unchanged', async () => {
      const worker = new Worker(
        queueName,
        async () => {
          throw new Error('error');
        },
        { autorun: false, connection, prefix },
      );
      await worker.waitUntilReady();

      await queue.add(
        'test',
        { foo: 'bar' },
        {
          attempts: 3,
          backoff: {
            type: 'linear',
            delay: 200,
            maxDelay: 100000,
          },
        },
      );

      const delays: number[] = [];

      const done = new Promise<void>((resolve, reject) => {
        worker.on('failed', async job => {
          try {
            if (job.attemptsMade < 3) {
              delays.push(job.delay);
            }
            if (job.attemptsMade >= 2) {
              expect(delays[0]).toEqual(200);
              expect(delays[1]).toEqual(400);
              resolve();
            }
          } catch (err) {
            reject(err);
          }
        });
      });

      worker.run();
      await done;
      await worker.close();
    });

    it('should treat maxDelay: 0 as no cap', async () => {
      const worker = new Worker(
        queueName,
        async () => {
          throw new Error('error');
        },
        { autorun: false, connection, prefix },
      );
      await worker.waitUntilReady();

      await queue.add(
        'test',
        { foo: 'bar' },
        {
          attempts: 3,
          backoff: {
            type: 'linear',
            delay: 200,
            maxDelay: 0,
          },
        },
      );

      const done = new Promise<void>((resolve, reject) => {
        worker.on('failed', async job => {
          try {
            if (job.attemptsMade === 2) {
              expect(job.delay).toEqual(400);
              resolve();
            }
          } catch (err) {
            reject(err);
          }
        });
      });

      worker.run();
      await done;
      await worker.close();
    });

    it('should cap custom strategy delays', async () => {
      const worker = new Worker(
        queueName,
        async () => {
          throw new Error('error');
        },
        {
          autorun: false,
          connection,
          prefix,
          settings: {
            backoffStrategy: () => 5000,
          },
        },
      );
      await worker.waitUntilReady();

      await queue.add(
        'test',
        { foo: 'bar' },
        {
          attempts: 3,
          backoff: {
            type: 'custom',
            delay: 100,
            maxDelay: 500,
          },
        },
      );

      const done = new Promise<void>((resolve, reject) => {
        worker.on('failed', async job => {
          try {
            if (job.attemptsMade < 3) {
              expect(job.delay).toEqual(500);
            }
            if (job.attemptsMade >= 2) {
              resolve();
            }
          } catch (err) {
            reject(err);
          }
        });
      });

      worker.run();
      await done;
      await worker.close();
    });
  });

  describe('errorBackoffs', () => {
    it('should use error-specific backoff when error name matches', async () => {
      const worker = new Worker(
        queueName,
        async () => {
          const err = new Error('rate limited');
          err.name = 'RateLimitError';
          throw err;
        },
        { autorun: false, connection, prefix },
      );
      await worker.waitUntilReady();

      await queue.add(
        'test',
        { foo: 'bar' },
        {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 100,
          },
          errorBackoffs: {
            RateLimitError: { type: 'fixed', delay: 200 },
          },
        },
      );

      const done = new Promise<void>((resolve, reject) => {
        worker.on('failed', async job => {
          try {
            if (job.attemptsMade < 3) {
              expect(job.delay).toEqual(200);
            }
            if (job.attemptsMade >= 2) {
              resolve();
            }
          } catch (err) {
            reject(err);
          }
        });
      });

      worker.run();
      await done;
      await worker.close();
    });

    it('should fall back to default backoff when error name does not match', async () => {
      const worker = new Worker(
        queueName,
        async () => {
          throw new TypeError('unexpected type');
        },
        { autorun: false, connection, prefix },
      );
      await worker.waitUntilReady();

      await queue.add(
        'test',
        { foo: 'bar' },
        {
          attempts: 3,
          backoff: {
            type: 'fixed',
            delay: 200,
          },
          errorBackoffs: {
            RateLimitError: { type: 'fixed', delay: 30000 },
          },
        },
      );

      const done = new Promise<void>((resolve, reject) => {
        worker.on('failed', async job => {
          try {
            if (job.attemptsMade < 3) {
              expect(job.delay).toEqual(200);
            }
            if (job.attemptsMade >= 2) {
              resolve();
            }
          } catch (err) {
            reject(err);
          }
        });
      });

      worker.run();
      await done;
      await worker.close();
    });

    it('should respect maxDelay on error-specific backoff entries', async () => {
      const worker = new Worker(
        queueName,
        async () => {
          const err = new Error('timeout');
          err.name = 'TimeoutError';
          throw err;
        },
        { autorun: false, connection, prefix },
      );
      await worker.waitUntilReady();

      await queue.add(
        'test',
        { foo: 'bar' },
        {
          attempts: 5,
          backoff: {
            type: 'fixed',
            delay: 100,
          },
          errorBackoffs: {
            TimeoutError: {
              type: 'linear',
              delay: 200,
              maxDelay: 500,
            },
          },
        },
      );

      const done = new Promise<void>((resolve, reject) => {
        worker.on('failed', async job => {
          try {
            if (job.attemptsMade < 5) {
              expect(job.delay).toBeLessThanOrEqual(500);
            }
            if (job.attemptsMade >= 3) {
              expect(job.delay).toEqual(500);
              resolve();
            }
          } catch (err) {
            reject(err);
          }
        });
      });

      worker.run();
      await done;
      await worker.close();
    });

    it('should preserve current behavior when errorBackoffs is omitted', async () => {
      const worker = new Worker(
        queueName,
        async () => {
          throw new Error('error');
        },
        { autorun: false, connection, prefix },
      );
      await worker.waitUntilReady();

      await queue.add(
        'test',
        { foo: 'bar' },
        {
          attempts: 3,
          backoff: {
            type: 'fixed',
            delay: 200,
          },
        },
      );

      const done = new Promise<void>((resolve, reject) => {
        worker.on('failed', async job => {
          try {
            if (job.attemptsMade < 3) {
              expect(job.delay).toEqual(200);
            }
            if (job.attemptsMade >= 2) {
              resolve();
            }
          } catch (err) {
            reject(err);
          }
        });
      });

      worker.run();
      await done;
      await worker.close();
    });
  });

  describe('existing strategies', () => {
    it('should preserve fixed backoff behavior', async () => {
      const worker = new Worker(
        queueName,
        async () => {
          throw new Error('error');
        },
        { autorun: false, connection, prefix },
      );
      await worker.waitUntilReady();

      await queue.add(
        'test',
        { foo: 'bar' },
        {
          attempts: 4,
          backoff: {
            type: 'fixed',
            delay: 2000,
          },
        },
      );

      const delays: number[] = [];

      const done = new Promise<void>((resolve, reject) => {
        worker.on('failed', async job => {
          try {
            if (job.attemptsMade < 4) {
              delays.push(job.delay);
            }
            if (job.attemptsMade >= 3) {
              expect(delays[0]).toEqual(2000);
              expect(delays[1]).toEqual(2000);
              expect(delays[2]).toEqual(2000);
              resolve();
            }
          } catch (err) {
            reject(err);
          }
        });
      });

      worker.run();
      await done;
      await worker.close();
    });

    it('should preserve exponential backoff behavior', async () => {
      const worker = new Worker(
        queueName,
        async () => {
          throw new Error('error');
        },
        { autorun: false, connection, prefix },
      );
      await worker.waitUntilReady();

      await queue.add(
        'test',
        { foo: 'bar' },
        {
          attempts: 4,
          backoff: {
            type: 'exponential',
            delay: 1000,
          },
        },
      );

      const delays: number[] = [];

      const done = new Promise<void>((resolve, reject) => {
        worker.on('failed', async job => {
          try {
            if (job.attemptsMade < 4) {
              delays.push(job.delay);
            }
            if (job.attemptsMade >= 3) {
              expect(delays[0]).toEqual(1000);
              expect(delays[1]).toEqual(2000);
              expect(delays[2]).toEqual(4000);
              resolve();
            }
          } catch (err) {
            reject(err);
          }
        });
      });

      worker.run();
      await done;
      await worker.close();
    });
  });
});
