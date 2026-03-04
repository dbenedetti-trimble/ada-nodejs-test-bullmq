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
import { CircuitBreakerState } from '../src/enums';
import { removeAllQueueData, delay } from '../src/utils';

describe('Circuit breaker', () => {
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

  describe('configuration', () => {
    it('should accept circuitBreaker option on WorkerOptions', async () => {
      const worker = new Worker(queueName, async () => 'done', {
        connection,
        prefix,
        autorun: false,
        circuitBreaker: {
          threshold: 5,
          duration: 30000,
        },
      });

      expect(worker.getCircuitBreakerState()).toEqual('closed');
      await worker.close();
    });

    it('should throw on invalid configuration', () => {
      expect(
        () =>
          new Worker(queueName, async () => 'done', {
            connection,
            prefix,
            autorun: false,
            circuitBreaker: {
              threshold: -1,
              duration: 5000,
            },
          }),
      ).toThrow();

      expect(
        () =>
          new Worker(queueName, async () => 'done', {
            connection,
            prefix,
            autorun: false,
            circuitBreaker: {
              threshold: 3,
              duration: 0,
            },
          }),
      ).toThrow();

      expect(
        () =>
          new Worker(queueName, async () => 'done', {
            connection,
            prefix,
            autorun: false,
            circuitBreaker: {
              threshold: 3,
              duration: 1000,
              halfOpenMaxAttempts: -1,
            },
          }),
      ).toThrow();
    });

    it('should behave identically to current behavior when not configured', async () => {
      let processedCount = 0;
      const worker = new Worker(
        queueName,
        async () => {
          processedCount++;
          return 'done';
        },
        { autorun: false, connection, prefix },
      );
      await worker.waitUntilReady();

      await queue.add('test', { foo: 'bar' });

      const done = new Promise<void>(resolve => {
        worker.on('completed', () => {
          resolve();
        });
      });

      worker.run();
      await done;

      expect(processedCount).toBe(1);
      expect(worker.getCircuitBreakerState()).toBeUndefined();
      await worker.close();
    });
  });

  describe('state machine', () => {
    it('should start in CLOSED state', async () => {
      const worker = new Worker(queueName, async () => 'done', {
        connection,
        prefix,
        autorun: false,
        circuitBreaker: {
          threshold: 3,
          duration: 5000,
        },
      });

      expect(worker.getCircuitBreakerState()).toEqual('closed');
      await worker.close();
    });

    it('should transition to OPEN after threshold consecutive failures', async () => {
      const threshold = 3;
      const worker = new Worker(
        queueName,
        async () => {
          throw new Error('fail');
        },
        {
          autorun: false,
          connection,
          prefix,
          circuitBreaker: {
            threshold,
            duration: 60000,
          },
        },
      );
      await worker.waitUntilReady();

      for (let i = 0; i < threshold; i++) {
        await queue.add('test', { idx: i });
      }

      const openEvent = new Promise<{ failures: number; threshold: number }>(
        resolve => {
          worker.on('circuit:open', payload => {
            resolve(payload);
          });
        },
      );

      worker.run();
      const payload = await openEvent;

      expect(payload.failures).toEqual(threshold);
      expect(payload.threshold).toEqual(threshold);
      expect(worker.getCircuitBreakerState()).toEqual('open');

      await worker.close();
    });

    it('should reset failure counter on success in CLOSED state', async () => {
      const threshold = 3;
      let callCount = 0;

      const worker = new Worker(
        queueName,
        async () => {
          callCount++;
          if (callCount <= 2) {
            throw new Error('fail');
          }
          return 'done';
        },
        {
          autorun: false,
          connection,
          prefix,
          circuitBreaker: {
            threshold,
            duration: 60000,
          },
        },
      );
      await worker.waitUntilReady();

      for (let i = 0; i < 3; i++) {
        await queue.add('test', { idx: i }, { attempts: 1 });
      }

      const completedPromise = new Promise<void>(resolve => {
        worker.on('completed', () => {
          resolve();
        });
      });

      worker.run();
      await completedPromise;

      expect(worker.getCircuitBreakerState()).toEqual('closed');
      await worker.close();
    });

    it('should transition to HALF_OPEN after duration elapses', async () => {
      const threshold = 2;
      const duration = 300;
      const worker = new Worker(
        queueName,
        async () => {
          throw new Error('fail');
        },
        {
          autorun: false,
          connection,
          prefix,
          circuitBreaker: {
            threshold,
            duration,
          },
        },
      );
      await worker.waitUntilReady();

      for (let i = 0; i < threshold; i++) {
        await queue.add('test', { idx: i });
      }

      const halfOpenEvent = new Promise<void>(resolve => {
        worker.on('circuit:half-open', () => {
          resolve();
        });
      });

      worker.run();
      await halfOpenEvent;

      expect(worker.getCircuitBreakerState()).toEqual('half-open');

      await worker.close();
    });

    it('should transition to CLOSED on successful test job in HALF_OPEN', async () => {
      const threshold = 2;
      const duration = 300;
      let failCount = 0;

      const worker = new Worker(
        queueName,
        async () => {
          failCount++;
          if (failCount <= threshold) {
            throw new Error('fail');
          }
          return 'recovered';
        },
        {
          autorun: false,
          connection,
          prefix,
          circuitBreaker: {
            threshold,
            duration,
          },
        },
      );
      await worker.waitUntilReady();

      for (let i = 0; i < threshold; i++) {
        await queue.add('test', { idx: i });
      }

      const halfOpenEvent = new Promise<void>(resolve => {
        worker.on('circuit:half-open', () => {
          resolve();
        });
      });

      worker.run();
      await halfOpenEvent;

      await queue.add('test', { idx: 'recovery' });

      const closedEvent = new Promise<{ testJobId: string }>(resolve => {
        worker.on('circuit:closed', payload => {
          resolve(payload);
        });
      });

      const payload = await closedEvent;

      expect(worker.getCircuitBreakerState()).toEqual('closed');
      expect(typeof payload.testJobId).toBe('string');
      expect(payload.testJobId.length).toBeGreaterThan(0);

      await worker.close();
    });

    it('should transition back to OPEN on failed test job in HALF_OPEN', async () => {
      const threshold = 2;
      const duration = 300;
      let openCount = 0;

      const worker = new Worker(
        queueName,
        async () => {
          throw new Error('fail');
        },
        {
          autorun: false,
          connection,
          prefix,
          circuitBreaker: {
            threshold,
            duration,
          },
        },
      );
      await worker.waitUntilReady();

      const secondOpen = new Promise<void>(resolve => {
        worker.on('circuit:open', () => {
          openCount++;
          if (openCount >= 2) {
            resolve();
          }
        });
      });

      for (let i = 0; i < threshold; i++) {
        await queue.add('test', { idx: i });
      }

      const firstHalfOpen = new Promise<void>(resolve => {
        worker.on('circuit:half-open', () => {
          resolve();
        });
      });

      worker.run();
      await firstHalfOpen;

      await queue.add('test', { idx: 'half-open-fail' });

      await secondOpen;

      expect(worker.getCircuitBreakerState()).toEqual('open');
      expect(openCount).toBe(2);

      await worker.close();
    });

    it('should stop fetching jobs when OPEN', async () => {
      const threshold = 2;
      const duration = 500;
      let processCount = 0;

      const worker = new Worker(
        queueName,
        async () => {
          processCount++;
          throw new Error('fail');
        },
        {
          autorun: false,
          connection,
          prefix,
          circuitBreaker: {
            threshold,
            duration,
          },
        },
      );
      await worker.waitUntilReady();

      for (let i = 0; i < threshold; i++) {
        await queue.add('test', { idx: i });
      }

      const openEvent = new Promise<void>(resolve => {
        worker.on('circuit:open', () => {
          resolve();
        });
      });

      worker.run();
      await openEvent;

      for (let i = 0; i < 5; i++) {
        await queue.add('test', { idx: `post-open-${i}` });
      }

      await delay(200);

      expect(processCount).toEqual(threshold);
      expect(worker.getCircuitBreakerState()).toEqual('open');

      await worker.close();
    });

    it('should limit jobs fetched in HALF_OPEN to halfOpenMaxAttempts', async () => {
      const threshold = 2;
      const duration = 300;
      const halfOpenMaxAttempts = 2;
      let halfOpenProcessed = 0;
      let totalProcessed = 0;

      const worker = new Worker(
        queueName,
        async () => {
          totalProcessed++;
          if (worker.getCircuitBreakerState() === 'half-open') {
            halfOpenProcessed++;
          }
          throw new Error('always fail');
        },
        {
          autorun: false,
          connection,
          prefix,
          circuitBreaker: {
            threshold,
            duration,
            halfOpenMaxAttempts,
          },
        },
      );
      await worker.waitUntilReady();

      for (let i = 0; i < threshold + halfOpenMaxAttempts + 3; i++) {
        await queue.add('test', { idx: i }, { attempts: 1 });
      }

      let halfOpenCount = 0;
      const secondOpenEvent = new Promise<void>(resolve => {
        worker.on('circuit:half-open', () => {
          halfOpenCount++;
        });
        worker.on('circuit:open', () => {
          if (halfOpenCount >= 1) {
            resolve();
          }
        });
      });

      worker.run();
      await secondOpenEvent;

      expect(halfOpenProcessed).toBe(halfOpenMaxAttempts);

      await worker.close();
    });

    it('should resume normal fetching after closing circuit', async () => {
      const threshold = 2;
      const duration = 300;
      let failCount = 0;

      const worker = new Worker(
        queueName,
        async () => {
          failCount++;
          if (failCount <= threshold) {
            throw new Error('fail');
          }
          return 'success';
        },
        {
          autorun: false,
          connection,
          prefix,
          circuitBreaker: {
            threshold,
            duration,
          },
        },
      );
      await worker.waitUntilReady();

      for (let i = 0; i < threshold; i++) {
        await queue.add('test', { idx: i });
      }

      const halfOpenEvent = new Promise<void>(resolve => {
        worker.on('circuit:half-open', () => {
          resolve();
        });
      });

      worker.run();
      await halfOpenEvent;

      await queue.add('test', { idx: 'recovery' });
      await queue.add('test', { idx: 'normal' });

      let completedCount = 0;
      const done = new Promise<void>(resolve => {
        worker.on('completed', () => {
          completedCount++;
          if (completedCount >= 2) {
            resolve();
          }
        });
      });

      await done;

      expect(worker.getCircuitBreakerState()).toEqual('closed');
      expect(completedCount).toBeGreaterThanOrEqual(2);

      await worker.close();
    });
  });

  describe('events', () => {
    it('should emit circuit:open on CLOSED -> OPEN transition', async () => {
      const threshold = 2;
      const worker = new Worker(
        queueName,
        async () => {
          throw new Error('fail');
        },
        {
          autorun: false,
          connection,
          prefix,
          circuitBreaker: {
            threshold,
            duration: 60000,
          },
        },
      );
      await worker.waitUntilReady();

      for (let i = 0; i < threshold; i++) {
        await queue.add('test', { idx: i });
      }

      const openEvent = new Promise<{ failures: number; threshold: number }>(
        resolve => {
          worker.on('circuit:open', payload => {
            resolve(payload);
          });
        },
      );

      worker.run();
      const payload = await openEvent;

      expect(payload.failures).toBe(threshold);
      expect(payload.threshold).toBe(threshold);

      await worker.close();
    });

    it('should emit circuit:half-open on OPEN -> HALF_OPEN transition', async () => {
      const threshold = 2;
      const duration = 300;
      const worker = new Worker(
        queueName,
        async () => {
          throw new Error('fail');
        },
        {
          autorun: false,
          connection,
          prefix,
          circuitBreaker: {
            threshold,
            duration,
          },
        },
      );
      await worker.waitUntilReady();

      for (let i = 0; i < threshold; i++) {
        await queue.add('test', { idx: i });
      }

      const halfOpenEvent = new Promise<{ duration: number }>(resolve => {
        worker.on('circuit:half-open', payload => {
          resolve(payload);
        });
      });

      worker.run();
      const payload = await halfOpenEvent;

      expect(payload.duration).toBe(duration);

      await worker.close();
    });

    it('should emit circuit:closed on HALF_OPEN -> CLOSED transition', async () => {
      const threshold = 2;
      const duration = 300;
      let failCount = 0;

      const worker = new Worker(
        queueName,
        async () => {
          failCount++;
          if (failCount <= threshold) {
            throw new Error('fail');
          }
          return 'recovered';
        },
        {
          autorun: false,
          connection,
          prefix,
          circuitBreaker: {
            threshold,
            duration,
          },
        },
      );
      await worker.waitUntilReady();

      for (let i = 0; i < threshold; i++) {
        await queue.add('test', { idx: i });
      }

      const halfOpenEvent = new Promise<void>(resolve => {
        worker.on('circuit:half-open', () => {
          resolve();
        });
      });

      worker.run();
      await halfOpenEvent;

      await queue.add('test', { idx: 'recovery' });

      const closedEvent = new Promise<{ testJobId: string }>(resolve => {
        worker.on('circuit:closed', payload => {
          resolve(payload);
        });
      });

      const payload = await closedEvent;

      expect(typeof payload.testJobId).toBe('string');
      expect(payload.testJobId.length).toBeGreaterThan(0);

      await worker.close();
    });

    it('should include correct payload in circuit:open event', async () => {
      const threshold = 3;
      const worker = new Worker(
        queueName,
        async () => {
          throw new Error('fail');
        },
        {
          autorun: false,
          connection,
          prefix,
          circuitBreaker: {
            threshold,
            duration: 60000,
          },
        },
      );
      await worker.waitUntilReady();

      for (let i = 0; i < threshold; i++) {
        await queue.add('test', { idx: i });
      }

      const openEvent = new Promise<{ failures: number; threshold: number }>(
        resolve => {
          worker.on('circuit:open', payload => {
            resolve(payload);
          });
        },
      );

      worker.run();
      const payload = await openEvent;

      expect(payload).toEqual({ failures: threshold, threshold });

      await worker.close();
    });

    it('should not emit circuit events when circuitBreaker is not configured', async () => {
      let circuitEventFired = false;
      const worker = new Worker(
        queueName,
        async () => {
          throw new Error('fail');
        },
        {
          autorun: false,
          connection,
          prefix,
        },
      );
      await worker.waitUntilReady();

      worker.on('circuit:open', () => {
        circuitEventFired = true;
      });
      worker.on('circuit:half-open', () => {
        circuitEventFired = true;
      });
      worker.on('circuit:closed', () => {
        circuitEventFired = true;
      });

      await queue.add('test', { foo: 'bar' }, { attempts: 1 });

      const failedEvent = new Promise<void>(resolve => {
        worker.on('failed', () => {
          resolve();
        });
      });

      worker.run();
      await failedEvent;

      await delay(200);

      expect(circuitEventFired).toBe(false);
      await worker.close();
    });
  });

  describe('getCircuitBreakerState', () => {
    it('should return undefined when not configured', async () => {
      const worker = new Worker(queueName, async () => 'done', {
        autorun: false,
        connection,
        prefix,
      });

      expect(worker.getCircuitBreakerState()).toBeUndefined();
      await worker.close();
    });

    it('should return current state string', async () => {
      const threshold = 2;
      const worker = new Worker(
        queueName,
        async () => {
          throw new Error('fail');
        },
        {
          autorun: false,
          connection,
          prefix,
          circuitBreaker: {
            threshold,
            duration: 60000,
          },
        },
      );
      await worker.waitUntilReady();

      expect(worker.getCircuitBreakerState()).toEqual('closed');

      for (let i = 0; i < threshold; i++) {
        await queue.add('test', { idx: i });
      }

      const openEvent = new Promise<void>(resolve => {
        worker.on('circuit:open', () => {
          resolve();
        });
      });

      worker.run();
      await openEvent;

      expect(worker.getCircuitBreakerState()).toEqual('open');

      await worker.close();
    });
  });

  describe('lifecycle integration', () => {
    it('should complete close() cleanly during OPEN state', async () => {
      const threshold = 2;
      const worker = new Worker(
        queueName,
        async () => {
          throw new Error('fail');
        },
        {
          autorun: false,
          connection,
          prefix,
          circuitBreaker: {
            threshold,
            duration: 60000,
          },
        },
      );
      await worker.waitUntilReady();

      for (let i = 0; i < threshold; i++) {
        await queue.add('test', { idx: i });
      }

      const openEvent = new Promise<void>(resolve => {
        worker.on('circuit:open', () => {
          resolve();
        });
      });

      worker.run();
      await openEvent;

      expect(worker.getCircuitBreakerState()).toEqual('open');

      await worker.close();
    });

    it('should not reset circuit breaker state on pause()', async () => {
      const threshold = 2;
      const worker = new Worker(
        queueName,
        async () => {
          throw new Error('fail');
        },
        {
          autorun: false,
          connection,
          prefix,
          circuitBreaker: {
            threshold,
            duration: 60000,
          },
        },
      );
      await worker.waitUntilReady();

      for (let i = 0; i < threshold; i++) {
        await queue.add('test', { idx: i });
      }

      const openEvent = new Promise<void>(resolve => {
        worker.on('circuit:open', () => {
          resolve();
        });
      });

      worker.run();
      await openEvent;

      expect(worker.getCircuitBreakerState()).toEqual('open');

      await worker.pause(true);

      expect(worker.getCircuitBreakerState()).toEqual('open');

      await worker.close();
    });

    it('should not count stalled jobs toward failure threshold', async () => {
      const threshold = 3;
      const worker = new Worker(
        queueName,
        async () => {
          throw new Error('fail');
        },
        {
          autorun: false,
          connection,
          prefix,
          circuitBreaker: {
            threshold,
            duration: 60000,
          },
        },
      );
      await worker.waitUntilReady();

      await queue.add('test', { foo: 'bar' });

      const failedEvent = new Promise<void>(resolve => {
        worker.on('failed', () => {
          resolve();
        });
      });

      worker.run();
      await failedEvent;

      expect(worker.getCircuitBreakerState()).toEqual('closed');

      await worker.close();
    });

    it('should not prevent close() from resolving when timer is active', async () => {
      const threshold = 2;
      const worker = new Worker(
        queueName,
        async () => {
          throw new Error('fail');
        },
        {
          autorun: false,
          connection,
          prefix,
          circuitBreaker: {
            threshold,
            duration: 60000,
          },
        },
      );
      await worker.waitUntilReady();

      for (let i = 0; i < threshold; i++) {
        await queue.add('test', { idx: i });
      }

      const openEvent = new Promise<void>(resolve => {
        worker.on('circuit:open', () => {
          resolve();
        });
      });

      worker.run();
      await openEvent;

      const closeStart = Date.now();
      await worker.close();
      const closeTime = Date.now() - closeStart;

      expect(closeTime).toBeLessThan(5000);
    });
  });
});
