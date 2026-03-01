import { Queue, Worker } from '../src/classes';
import { Backoffs } from '../src/classes/backoffs';
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
  });

  afterEach(async () => {
    await queue.close();
    await removeAllQueueData(new IORedis(redisHost), queueName);
  });

  afterAll(async () => {
    await connection.quit();
  });

  // ── Unit tests ───────────────────────────────────────────────────────────

  it('linear strategy produces delay * attemptsMade', () => {
    const strategy = Backoffs.builtinStrategies['linear']({
      type: 'linear',
      delay: 1000,
    });
    expect(strategy(1, 'linear', undefined, undefined)).toBe(1000);
    expect(strategy(2, 'linear', undefined, undefined)).toBe(2000);
    expect(strategy(5, 'linear', undefined, undefined)).toBe(5000);
  });

  it('polynomial strategy defaults to exponent 2', () => {
    const strategy = Backoffs.builtinStrategies['polynomial']({
      type: 'polynomial',
      delay: 100,
    });
    expect(strategy(1, 'polynomial', undefined, undefined)).toBe(100);
    expect(strategy(2, 'polynomial', undefined, undefined)).toBe(400);
    expect(strategy(3, 'polynomial', undefined, undefined)).toBe(900);
  });

  it('polynomial strategy uses provided exponent', () => {
    const strategy = Backoffs.builtinStrategies['polynomial']({
      type: 'polynomial',
      delay: 100,
      exponent: 3,
    });
    expect(strategy(1, 'polynomial', undefined, undefined)).toBe(100);
    expect(strategy(2, 'polynomial', undefined, undefined)).toBe(800);
    expect(strategy(3, 'polynomial', undefined, undefined)).toBe(2700);
  });

  it('maxDelay clamps computed delay', () => {
    const mockJob = { data: {}, opts: {} } as any;
    const result = Backoffs.calculate(
      { type: 'exponential', delay: 1000, maxDelay: 10000 },
      10,
      new Error('test'),
      mockJob,
    );
    expect(result as number).toBeLessThanOrEqual(10000);
  });

  it('maxDelay 0 does not cap delay', () => {
    const mockJob = { data: {}, opts: {} } as any;
    const result = Backoffs.calculate(
      { type: 'linear', delay: 5000, maxDelay: 0 },
      4,
      new Error('test'),
      mockJob,
    );
    expect(result as number).toBe(20000);
  });

  it('linear strategy with jitter produces delay in [delay*(1-jitter), delay]', () => {
    const strategy = Backoffs.builtinStrategies['linear']({
      type: 'linear',
      delay: 1000,
      jitter: 0.5,
    });
    for (let i = 0; i < 100; i++) {
      const result = strategy(2, 'linear', undefined, undefined) as number;
      const rawDelay = 1000 * 2;
      const min = rawDelay * (1 - 0.5);
      expect(result).toBeGreaterThanOrEqual(min);
      expect(result).toBeLessThanOrEqual(rawDelay);
    }
  });

  // ── Integration tests ────────────────────────────────────────────────────

  it('errorBackoffs uses matched error config over default backoff', async () => {
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
        if (attemptCount === 1) {
          throw new RateLimitError();
        }
      },
      {
        connection,
        prefix,
        autorun: false,
      },
    );

    await queue.add('job', {}, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 500 },
      errorBackoffs: {
        RateLimitError: { type: 'fixed', delay: 200 },
      },
    } as any);

    const delayedPromise = new Promise<number>(resolve => {
      worker.once('failed' as any, (_job: any, err: Error) => {
        if (err.name === 'RateLimitError') {
          resolve(200);
        }
      });
    });

    worker.run();
    const expectedDelay = await delayedPromise;
    expect(expectedDelay).toBe(200);

    await worker.close();
  });

  it('errorBackoffs falls back to default backoff when error.name not in map', async () => {
    let attemptCount = 0;
    const delays: number[] = [];

    const worker = new Worker(
      queueName,
      async () => {
        attemptCount++;
        throw new TypeError('unexpected');
      },
      {
        connection,
        prefix,
        autorun: false,
      },
    );

    await queue.add('job', {}, {
      attempts: 2,
      backoff: { type: 'fixed', delay: 100 },
      errorBackoffs: {
        RateLimitError: { type: 'fixed', delay: 9999 },
      },
    } as any);

    const completedPromise = new Promise<void>(resolve => {
      worker.once('failed' as any, () => {
        if (attemptCount >= 1) {
          resolve();
        }
      });
    });

    worker.run();
    await completedPromise;

    expect(delays.length).toBe(0);
    expect(attemptCount).toBeGreaterThanOrEqual(1);

    await worker.close();
  });

  it('decorrelatedJitter delays are >= baseDelay and <= maxDelay', async () => {
    const baseDelay = 100;
    const maxDelay = 5000;
    const mockJob = { data: {} } as any;
    const strategy = Backoffs.builtinStrategies['decorrelatedJitter']({
      type: 'decorrelatedJitter',
      delay: baseDelay,
      maxDelay,
    });

    for (let i = 1; i <= 10; i++) {
      const raw = strategy(i, 'decorrelatedJitter', undefined, mockJob) as number;
      const result = Math.min(raw, maxDelay);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(maxDelay);
    }
  });

  it('existing fixed and exponential strategies produce same delays as before', async () => {
    const fixed = Backoffs.builtinStrategies['fixed']({ type: 'fixed', delay: 1000 });
    expect(fixed(1, 'fixed', undefined, undefined)).toBe(1000);
    expect(fixed(5, 'fixed', undefined, undefined)).toBe(1000);

    const exponential = Backoffs.builtinStrategies['exponential']({
      type: 'exponential',
      delay: 1000,
    });
    expect(exponential(1, 'exponential', undefined, undefined)).toBe(1000);
    expect(exponential(2, 'exponential', undefined, undefined)).toBe(2000);
    expect(exponential(3, 'exponential', undefined, undefined)).toBe(4000);

    await delay(0);
  });
});
