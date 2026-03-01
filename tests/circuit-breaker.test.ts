import { Queue, Worker } from '../src/classes';
import { delay, removeAllQueueData } from '../src/utils';
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

describe('Circuit breaker', () => {
  const redisHost = process.env.REDIS_HOST || 'localhost';
  const prefix = process.env.BULLMQ_TEST_PREFIX || 'bull';

  let queue: Queue;
  let queueName: string;
  let connection: IORedis;
  let worker: Worker | undefined;

  beforeAll(async () => {
    connection = new IORedis(redisHost, { maxRetriesPerRequest: null });
  });

  beforeEach(async () => {
    queueName = `test-${v4()}`;
    queue = new Queue(queueName, { connection, prefix });
    worker = undefined;
  });

  afterEach(async () => {
    if (worker) {
      try {
        await worker.close();
      } catch (_) {
        // ignore
      }
    }
    await queue.close();
    await removeAllQueueData(new IORedis(redisHost), queueName);
  });

  afterAll(async () => {
    await connection.quit();
  });

  // ── Integration tests ────────────────────────────────────────────────────

  it('circuit opens after threshold failures and emits circuit:open', async () => {
    const threshold = 3;

    worker = new Worker(
      queueName,
      async () => {
        throw new Error('fail');
      },
      {
        connection,
        prefix,
        autorun: false,
        circuitBreaker: { threshold, duration: 60000 },
      },
    );

    await queue.addBulk([
      { name: 'j1', data: {} },
      { name: 'j2', data: {} },
      { name: 'j3', data: {} },
    ]);

    const circuitOpenPromise = new Promise<{ failures: number; threshold: number }>(
      resolve => {
        worker!.once('circuit:open', payload => resolve(payload));
      },
    );

    worker.run();

    const payload = await circuitOpenPromise;
    expect(payload.failures).toBe(threshold);
    expect(payload.threshold).toBe(threshold);
    expect(worker.getCircuitBreakerState()).toBe('open');
  });

  it('success in CLOSED state resets failure counter', async () => {
    let callCount = 0;

    worker = new Worker(
      queueName,
      async () => {
        callCount++;
        if (callCount === 1 || callCount === 2) {
          throw new Error('fail');
        }
        // callCount 3 succeeds — resets the counter
      },
      {
        connection,
        prefix,
        autorun: false,
        circuitBreaker: { threshold: 3, duration: 60000 },
      },
    );

    // 2 failures, 1 success
    for (let i = 0; i < 3; i++) {
      await queue.add('job', {});
    }

    const failedCount = { n: 0 };
    const completedPromise = new Promise<void>(resolve => {
      worker!.on('completed', () => resolve());
    });
    worker!.on('failed', () => {
      failedCount.n++;
    });

    worker.run();
    await completedPromise;

    expect(worker.getCircuitBreakerState()).toBe('closed');

    // 2 more failures — counter resets to 0 after success, so should still be closed (2 < 3)
    await queue.add('job', {});
    await queue.add('job', {});

    const failedAgainPromise = new Promise<void>(resolve => {
      let cnt = 0;
      worker!.on('failed', () => {
        cnt++;
        if (cnt >= 2) resolve();
      });
    });

    await failedAgainPromise;
    expect(worker.getCircuitBreakerState()).toBe('closed');
  });

  it('transitions to half-open after duration elapses', async () => {
    const duration = 200;

    worker = new Worker(
      queueName,
      async () => {
        throw new Error('fail');
      },
      {
        connection,
        prefix,
        autorun: false,
        circuitBreaker: { threshold: 2, duration },
      },
    );

    await queue.addBulk([{ name: 'j1', data: {} }, { name: 'j2', data: {} }]);

    const halfOpenPromise = new Promise<void>(resolve => {
      worker!.once('circuit:half-open', () => resolve());
    });

    worker.run();

    await halfOpenPromise;
    expect(worker.getCircuitBreakerState()).toBe('half-open');
  });

  it('successful test job in half-open transitions to closed', async () => {
    const duration = 200;
    let callCount = 0;

    worker = new Worker(
      queueName,
      async () => {
        callCount++;
        if (callCount <= 2) {
          throw new Error('fail');
        }
        // test job succeeds
      },
      {
        connection,
        prefix,
        autorun: false,
        circuitBreaker: { threshold: 2, duration, halfOpenMaxAttempts: 1 },
      },
    );

    await queue.addBulk([
      { name: 'j1', data: {} },
      { name: 'j2', data: {} },
    ]);

    const halfOpenPromise = new Promise<void>(resolve => {
      worker!.once('circuit:half-open', () => resolve());
    });

    worker.run();
    await halfOpenPromise;

    // Add test job for HALF_OPEN recovery
    const testJob = await queue.add('test-job', {});
    const testJobId = testJob.id!;

    const closedPromise = new Promise<{ testJobId: string }>(resolve => {
      worker!.once('circuit:closed', payload => resolve(payload));
    });

    const payload = await closedPromise;
    expect(payload.testJobId).toBe(testJobId);
    expect(worker.getCircuitBreakerState()).toBe('closed');
  });

  it('failed test job in half-open transitions back to open', async () => {
    const duration = 150;
    let callCount = 0;

    worker = new Worker(
      queueName,
      async () => {
        callCount++;
        // Always fail — test job also fails
        throw new Error('always fail');
      },
      {
        connection,
        prefix,
        autorun: false,
        circuitBreaker: { threshold: 2, duration, halfOpenMaxAttempts: 1 },
      },
    );

    await queue.addBulk([
      { name: 'j1', data: {} },
      { name: 'j2', data: {} },
    ]);

    const halfOpenPromise = new Promise<void>(resolve => {
      worker!.once('circuit:half-open', () => resolve());
    });

    worker.run();
    await halfOpenPromise;

    // Add test job — it will fail and circuit should go back to OPEN
    await queue.add('test-job', {});

    // Wait for next half-open (duration timer restarts)
    const secondHalfOpenPromise = new Promise<void>(resolve => {
      worker!.once('circuit:half-open', () => resolve());
    });

    await secondHalfOpenPromise;
    // State cycles back to half-open (was OPEN → HALF_OPEN again), which means it did go through OPEN
    expect(worker.getCircuitBreakerState()).toBe('half-open');
  });

  it('worker does not process jobs while circuit is open', async () => {
    const duration = 500;

    worker = new Worker(
      queueName,
      async () => {
        throw new Error('fail');
      },
      {
        connection,
        prefix,
        autorun: false,
        circuitBreaker: { threshold: 2, duration },
      },
    );

    await queue.addBulk([{ name: 'j1', data: {} }, { name: 'j2', data: {} }]);

    const openPromise = new Promise<void>(resolve => {
      worker!.once('circuit:open', () => resolve());
    });

    worker.run();
    await openPromise;

    // Add more jobs while circuit is open
    await queue.add('extra', {});

    // Wait briefly and check state is still open (jobs not processed)
    await delay(100);
    expect(worker.getCircuitBreakerState()).toBe('open');

    const waitingCount = await queue.getWaitingCount();
    expect(waitingCount).toBeGreaterThanOrEqual(1);
  });

  // ── Unit tests ───────────────────────────────────────────────────────────

  it('returns undefined when circuitBreaker not configured', () => {
    const w = new Worker(queueName, async () => {}, {
      connection,
      prefix,
      autorun: false,
    });
    expect(w.getCircuitBreakerState()).toBeUndefined();
    w.close().catch(() => {});
  });

  it('close() during OPEN state resolves without waiting for duration', async () => {
    worker = new Worker(
      queueName,
      async () => {
        throw new Error('fail');
      },
      {
        connection,
        prefix,
        autorun: false,
        circuitBreaker: { threshold: 2, duration: 60000 },
      },
    );

    await queue.addBulk([{ name: 'j1', data: {} }, { name: 'j2', data: {} }]);

    const openPromise = new Promise<void>(resolve => {
      worker!.once('circuit:open', () => resolve());
    });

    worker.run();
    await openPromise;

    const start = Date.now();
    await worker.close();
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(2000);
  });

  it('stalled jobs do not contribute to circuit breaker failure count', async () => {
    worker = new Worker(
      queueName,
      async () => {
        // Hang forever — will be stalled
        await new Promise(() => {});
      },
      {
        connection,
        prefix,
        autorun: false,
        circuitBreaker: { threshold: 2, duration: 60000 },
        stalledInterval: 100,
        lockDuration: 100,
        maxStalledCount: 1,
      },
    );

    await queue.add('stall-job', {});

    // Wait for stall to be detected
    const stalledPromise = new Promise<void>(resolve => {
      worker!.once('stalled', () => resolve());
    });

    worker.run();
    await stalledPromise;

    // Circuit should still be closed — stall should not have incremented the failure counter
    expect(worker.getCircuitBreakerState()).toBe('closed');
  });

  it('throws synchronously for invalid circuitBreaker options', () => {
    expect(() => {
      new Worker(queueName, async () => {}, {
        connection,
        prefix,
        autorun: false,
        circuitBreaker: { threshold: -1, duration: 1000 },
      });
    }).toThrow('circuitBreaker.threshold must be a positive integer');

    expect(() => {
      new Worker(queueName, async () => {}, {
        connection,
        prefix,
        autorun: false,
        circuitBreaker: { threshold: 3, duration: 0 },
      });
    }).toThrow('circuitBreaker.duration must be a positive integer');
  });
});
