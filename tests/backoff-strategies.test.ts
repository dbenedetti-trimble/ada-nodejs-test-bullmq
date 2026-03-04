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

  let connection;
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
    it.todo(
      'should produce linearly increasing delays',
    );

    it.todo(
      'should apply jitter within expected range',
    );
  });

  describe('polynomial', () => {
    it.todo(
      'should produce quadratic delays with default exponent',
    );

    it.todo(
      'should produce cubic delays with exponent 3',
    );

    it.todo(
      'should apply jitter within expected range',
    );
  });

  describe('decorrelatedJitter', () => {
    it.todo(
      'should produce delays within bounded range',
    );

    it.todo(
      'should respect maxDelay cap',
    );

    it.todo(
      'should produce non-deterministic delays',
    );
  });

  describe('maxDelay', () => {
    it.todo(
      'should cap exponential backoff delay',
    );

    it.todo(
      'should cap linear backoff delay',
    );

    it.todo(
      'should pass through delays below the cap unchanged',
    );

    it.todo(
      'should treat maxDelay: 0 as no cap',
    );

    it.todo(
      'should cap custom strategy delays',
    );
  });

  describe('errorBackoffs', () => {
    it.todo(
      'should use error-specific backoff when error name matches',
    );

    it.todo(
      'should fall back to default backoff when error name does not match',
    );

    it.todo(
      'should respect maxDelay on error-specific backoff entries',
    );

    it.todo(
      'should preserve current behavior when errorBackoffs is omitted',
    );
  });

  describe('existing strategies', () => {
    it.todo(
      'should preserve fixed backoff behavior',
    );

    it.todo(
      'should preserve exponential backoff behavior',
    );
  });
});
