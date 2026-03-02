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
import { Queue, Worker } from '../src/classes';
import { CircuitBreaker } from '../src/classes/circuit-breaker';
import { CircuitBreakerState } from '../src/enums/circuit-breaker-state';
import { removeAllQueueData, delay } from '../src/utils';

describe('CircuitBreaker (unit)', () => {
  it('should start in CLOSED state', () => {
    const cb = new CircuitBreaker({ threshold: 3, duration: 1000 });
    expect(cb.getState()).toBe(CircuitBreakerState.CLOSED);
    cb.close();
  });

  it('should transition to OPEN after threshold failures', () => {
    const cb = new CircuitBreaker({ threshold: 3, duration: 1000 });
    cb.recordFailure();
    cb.recordFailure();
    const transition = cb.recordFailure();
    expect(transition).toBeDefined();
    expect(transition!.state).toBe(CircuitBreakerState.OPEN);
    expect(cb.getState()).toBe(CircuitBreakerState.OPEN);
    cb.close();
  });

  it('should reset failure counter on success in CLOSED state', () => {
    const cb = new CircuitBreaker({ threshold: 3, duration: 1000 });
    cb.recordFailure();
    cb.recordFailure();
    cb.recordSuccess();
    const transition = cb.recordFailure();
    expect(transition).toBeUndefined();
    expect(cb.getState()).toBe(CircuitBreakerState.CLOSED);
    cb.close();
  });

  it('should transition to HALF_OPEN after duration', async () => {
    const cb = new CircuitBreaker({ threshold: 1, duration: 100 });
    cb.recordFailure();
    expect(cb.getState()).toBe(CircuitBreakerState.OPEN);
    await delay(150);
    expect(cb.getState()).toBe(CircuitBreakerState.HALF_OPEN);
    cb.close();
  });

  it('should transition to CLOSED on success in HALF_OPEN', async () => {
    const cb = new CircuitBreaker({ threshold: 1, duration: 100 });
    cb.recordFailure();
    await delay(150);
    expect(cb.getState()).toBe(CircuitBreakerState.HALF_OPEN);
    const transition = cb.recordSuccess();
    expect(transition).toBeDefined();
    expect(transition!.state).toBe(CircuitBreakerState.CLOSED);
    expect(cb.getState()).toBe(CircuitBreakerState.CLOSED);
    cb.close();
  });

  it('should transition back to OPEN on failure in HALF_OPEN', async () => {
    const cb = new CircuitBreaker({ threshold: 1, duration: 100 });
    cb.recordFailure();
    await delay(150);
    expect(cb.getState()).toBe(CircuitBreakerState.HALF_OPEN);
    const transition = cb.recordFailure();
    expect(transition).toBeDefined();
    expect(transition!.state).toBe(CircuitBreakerState.OPEN);
    cb.close();
  });

  it('should allow jobs in CLOSED state', () => {
    const cb = new CircuitBreaker({ threshold: 3, duration: 1000 });
    expect(cb.shouldAllowJob()).toBe(true);
    cb.close();
  });

  it('should not allow jobs in OPEN state', () => {
    const cb = new CircuitBreaker({ threshold: 1, duration: 1000 });
    cb.recordFailure();
    expect(cb.shouldAllowJob()).toBe(false);
    cb.close();
  });

  it('should allow limited jobs in HALF_OPEN state', async () => {
    const cb = new CircuitBreaker({
      threshold: 1,
      duration: 100,
      halfOpenMaxAttempts: 1,
    });
    cb.recordFailure();
    await delay(150);
    expect(cb.shouldAllowJob()).toBe(true);
    cb.trackHalfOpenAttempt();
    expect(cb.shouldAllowJob()).toBe(false);
    cb.close();
  });

  it('should throw on invalid threshold', () => {
    expect(() => new CircuitBreaker({ threshold: -1, duration: 1000 })).toThrow(
      'circuitBreaker.threshold must be a positive integer',
    );
  });

  it('should throw on invalid duration', () => {
    expect(() => new CircuitBreaker({ threshold: 3, duration: 0 })).toThrow(
      'circuitBreaker.duration must be a positive integer',
    );
  });

  it('should resolve waitForHalfOpen when timer fires', async () => {
    const cb = new CircuitBreaker({ threshold: 1, duration: 100 });
    cb.recordFailure();
    const start = Date.now();
    await cb.waitForHalfOpen();
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(80);
    expect(cb.getState()).toBe(CircuitBreakerState.HALF_OPEN);
    cb.close();
  });

  it('should resolve waitForHalfOpen immediately when close() is called', async () => {
    const cb = new CircuitBreaker({ threshold: 1, duration: 60000 });
    cb.recordFailure();
    const waitPromise = cb.waitForHalfOpen();
    setTimeout(() => cb.close(), 50);
    const start = Date.now();
    await waitPromise;
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(200);
  });
});

describe('CircuitBreaker (integration)', () => {
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

  it('should open circuit after threshold failures and emit circuit:open', async () => {
    const openPromise = new Promise<{
      failures: number;
      threshold: number;
    }>((resolve, reject) => {
      const worker = new Worker(
        queueName,
        async () => {
          throw new Error('always fail');
        },
        {
          connection,
          prefix,
          circuitBreaker: { threshold: 3, duration: 500 },
        },
      );

      worker.on('circuit:open', async payload => {
        expect(worker.getCircuitBreakerState()).toBe('open');
        resolve(payload);
        await worker.close();
      });

      (async () => {
        await worker.waitUntilReady();
        for (let i = 0; i < 5; i++) {
          await queue.add('test', { idx: i });
        }
      })();

      setTimeout(async () => {
        reject(new Error('Test timed out'));
        await worker.close();
      }, 8000);
    });

    const payload = await openPromise;
    expect(payload.failures).toBe(3);
    expect(payload.threshold).toBe(3);
  });

  it('should emit circuit:half-open after duration elapses', async () => {
    const halfOpenPromise = new Promise<void>(resolve => {
      const worker = new Worker(
        queueName,
        async () => {
          throw new Error('fail');
        },
        {
          connection,
          prefix,
          circuitBreaker: { threshold: 2, duration: 500 },
        },
      );

      worker.on('circuit:half-open', async () => {
        resolve();
        await worker.close();
      });

      (async () => {
        await worker.waitUntilReady();
        for (let i = 0; i < 5; i++) {
          await queue.add('test', { idx: i });
        }
      })();

      setTimeout(async () => {
        await worker.close();
        resolve();
      }, 5000);
    });

    await halfOpenPromise;
  });

  it('should close circuit on successful test job and emit circuit:closed', async () => {
    let attemptCount = 0;

    const closedPromise = new Promise<{ testJobId: string }>(
      (resolve, reject) => {
        const worker = new Worker(
          queueName,
          async () => {
            attemptCount++;
            if (attemptCount <= 2) {
              throw new Error('fail');
            }
          },
          {
            connection,
            prefix,
            circuitBreaker: { threshold: 2, duration: 300 },
          },
        );

        worker.on('circuit:closed', async payload => {
          resolve(payload);
          await worker.close();
        });

        (async () => {
          await worker.waitUntilReady();
          for (let i = 0; i < 5; i++) {
            await queue.add('test', { idx: i });
          }
        })();

        setTimeout(async () => {
          reject(new Error('Test timed out'));
          await worker.close();
        }, 10000);
      },
    );

    const payload = await closedPromise;
    expect(payload.testJobId).toBeDefined();
  });

  it('should return undefined when circuit breaker is not configured', async () => {
    const worker = new Worker(queueName, async () => {}, {
      connection,
      prefix,
    });
    await worker.waitUntilReady();

    expect(worker.getCircuitBreakerState()).toBeUndefined();

    await worker.close();
  });

  it('should close cleanly during OPEN state without waiting for duration', async () => {
    const worker = new Worker(
      queueName,
      async () => {
        throw new Error('fail');
      },
      {
        connection,
        prefix,
        circuitBreaker: { threshold: 1, duration: 60000 },
      },
    );
    await worker.waitUntilReady();

    await queue.add('test', {});

    await new Promise<void>(resolve => {
      worker.on('failed', () => {
        resolve();
      });
    });

    expect(worker.getCircuitBreakerState()).toBe('open');

    const start = Date.now();
    await worker.close();
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(5000);
  });

  it('should reset failure counter on success in CLOSED state', async () => {
    let attemptCount = 0;

    const worker = new Worker(
      queueName,
      async () => {
        attemptCount++;
        if (attemptCount <= 2) {
          throw new Error('fail');
        }
      },
      {
        connection,
        prefix,
        circuitBreaker: { threshold: 3, duration: 60000 },
      },
    );
    await worker.waitUntilReady();

    await queue.add('test-0', { idx: 0 });
    await queue.add('test-1', { idx: 1 });
    await queue.add('test-2', { idx: 2 });

    await new Promise<void>(resolve => {
      worker.on('completed', () => {
        resolve();
      });
    });

    expect(worker.getCircuitBreakerState()).toBe('closed');

    await worker.close();
  });
});
