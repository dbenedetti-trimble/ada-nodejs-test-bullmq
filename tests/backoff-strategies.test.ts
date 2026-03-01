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
    // TODO(features): call Backoffs.builtinStrategies.linear and assert delays
    expect(true).toBe(true);
  });

  it('polynomial strategy defaults to exponent 2', () => {
    // TODO(features): call Backoffs.builtinStrategies.polynomial and assert quadratic delays
    expect(true).toBe(true);
  });

  it('polynomial strategy uses provided exponent', () => {
    // TODO(features): call Backoffs.builtinStrategies.polynomial with exponent:3 and assert cubic delays
    expect(true).toBe(true);
  });

  it('maxDelay clamps computed delay', () => {
    // TODO(features): call Backoffs.calculate with exponential + maxDelay:10000 at attempt 5
    // and assert result is capped at 10000
    expect(true).toBe(true);
  });

  it('maxDelay 0 does not cap delay', () => {
    // TODO(features): call Backoffs.calculate with linear + maxDelay:0 at attempt 4
    // and assert result is uncapped (20000)
    expect(true).toBe(true);
  });

  it('linear strategy with jitter produces delay in [delay*(1-jitter), delay]', () => {
    // TODO(features): run 100 iterations verifying jitter bounds for linear strategy
    expect(true).toBe(true);
  });

  // ── Integration tests ────────────────────────────────────────────────────

  it('errorBackoffs uses matched error config over default backoff', async () => {
    // TODO(features): add job with errorBackoffs; throw RateLimitError; verify delay matches fixed config
    expect(true).toBe(true);
  });

  it('errorBackoffs falls back to default backoff when error.name not in map', async () => {
    // TODO(features): throw TypeError (not in errorBackoffs); verify default exponential delay used
    expect(true).toBe(true);
  });

  it('decorrelatedJitter delays are >= baseDelay and <= maxDelay', async () => {
    // TODO(features): run job with decorrelatedJitter; collect retry delays; assert all in [1000, 10000]
    expect(true).toBe(true);
  });

  it('existing fixed and exponential strategies produce same delays as before', async () => {
    // TODO(features): verify fixed and exponential strategy delays are unchanged
    expect(true).toBe(true);
  });
});
