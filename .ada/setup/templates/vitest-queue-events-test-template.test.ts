/**
 * BullMQ Queue Events Test Template
 *
 * Tests for QueueEvents - the event-driven monitoring system in BullMQ.
 * QueueEvents connects to Redis and subscribes to job lifecycle events,
 * enabling reactive patterns for job monitoring and coordination.
 *
 * Key patterns:
 * - QueueEvents.waitUntilReady() before listening for events
 * - Promise-based event resolution with proper typing
 * - Close QueueEvents in afterEach alongside Queue
 * - Use QueueEventsListener type for typed event handlers
 *
 * Execution: yarn test (runs pretest + vitest)
 *            npx vitest tests/<file>.test.ts (single file)
 */

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
import { Queue, QueueEvents, Worker, Job } from '../src/classes';
import { removeAllQueueData, delay } from '../src/utils';

describe('[FEATURE_NAME] - Queue Events', () => {
  const redisHost = process.env.REDIS_HOST || 'localhost';
  const prefix = process.env.BULLMQ_TEST_PREFIX || 'bull';

  let queue: Queue;
  let queueEvents: QueueEvents;
  let queueName: string;

  let connection: IORedis;
  beforeAll(async () => {
    connection = new IORedis(redisHost, { maxRetriesPerRequest: null });
  });

  beforeEach(async () => {
    queueName = `test-${v4()}`;
    queue = new Queue(queueName, { connection, prefix });
    queueEvents = new QueueEvents(queueName, { connection, prefix });
    await queue.waitUntilReady();
    await queueEvents.waitUntilReady();
  });

  afterEach(async () => {
    await queue.close();
    await queueEvents.close();
    await removeAllQueueData(new IORedis(redisHost), queueName);
  });

  afterAll(async () => {
    await connection.quit();
  });

  describe('job lifecycle events', () => {
    it('should emit waiting event when job is added', async () => {
      const waiting = new Promise<{ jobId: string }>(resolve => {
        queueEvents.on('waiting', event => {
          resolve(event);
        });
      });

      const job = await queue.add('test', { foo: 'bar' });

      const event = await waiting;
      expect(event.jobId).toBe(job.id);
    });

    it('should emit active event when job starts processing', async () => {
      const active = new Promise<{ jobId: string }>(resolve => {
        queueEvents.on('active', event => {
          resolve(event);
        });
      });

      const worker = new Worker(
        queueName,
        async () => {
          await delay(100);
          return 'done';
        },
        { connection, prefix },
      );
      await worker.waitUntilReady();

      const job = await queue.add('test', { data: 'test' });
      const event = await active;

      expect(event.jobId).toBe(job.id);

      await worker.close();
    });

    it('should emit completed event when job finishes', async () => {
      const completed = new Promise<{ jobId: string; returnvalue: string }>(
        resolve => {
          queueEvents.on('completed', event => {
            resolve(event);
          });
        },
      );

      const worker = new Worker(
        queueName,
        async () => {
          return 'result-value';
        },
        { connection, prefix },
      );
      await worker.waitUntilReady();

      const job = await queue.add('test', { data: 'test' });
      const event = await completed;

      expect(event.jobId).toBe(job.id);
      expect(event.returnvalue).toBe(JSON.stringify('result-value'));

      await worker.close();
    });

    it('should emit failed event when job throws', async () => {
      const errorMessage = 'Intentional test failure';

      const failed = new Promise<{ jobId: string; failedReason: string }>(
        resolve => {
          queueEvents.on('failed', event => {
            resolve(event);
          });
        },
      );

      const worker = new Worker(
        queueName,
        async () => {
          throw new Error(errorMessage);
        },
        { connection, prefix },
      );
      await worker.waitUntilReady();

      const job = await queue.add('test', { data: 'test' });
      const event = await failed;

      expect(event.jobId).toBe(job.id);
      expect(event.failedReason).toBe(errorMessage);

      await worker.close();
    });
  });

  describe('progress events', () => {
    it('should emit progress event', async () => {
      const progressValues: number[] = [];

      const allProgress = new Promise<void>(resolve => {
        queueEvents.on('progress', ({ data }) => {
          progressValues.push(data as number);
          if (progressValues.length === 3) {
            resolve();
          }
        });
      });

      const worker = new Worker(
        queueName,
        async (job: Job) => {
          await job.updateProgress(25);
          await job.updateProgress(50);
          await job.updateProgress(100);
          return 'done';
        },
        { connection, prefix },
      );
      await worker.waitUntilReady();

      await queue.add('test', { data: 'test' });
      await allProgress;

      expect(progressValues).toEqual([25, 50, 100]);

      await worker.close();
    });
  });

  describe('delayed job events', () => {
    it('should emit delayed event for delayed jobs', async () => {
      const delayed = new Promise<{ jobId: string }>(resolve => {
        queueEvents.on('delayed', event => {
          resolve(event);
        });
      });

      const job = await queue.add(
        'delayed-job',
        { data: 'test' },
        { delay: 5000 },
      );
      const event = await delayed;

      expect(event.jobId).toBe(job.id);
    });
  });

  describe('event ordering', () => {
    it('should emit events in lifecycle order: waiting -> active -> completed', async () => {
      const events: string[] = [];

      const completed = new Promise<void>(resolve => {
        queueEvents.on('waiting', () => events.push('waiting'));
        queueEvents.on('active', () => events.push('active'));
        queueEvents.on('completed', () => {
          events.push('completed');
          resolve();
        });
      });

      const worker = new Worker(queueName, async () => 'done', {
        connection,
        prefix,
      });
      await worker.waitUntilReady();

      await queue.add('test', { data: 'test' });
      await completed;

      expect(events).toContain('waiting');
      expect(events).toContain('active');
      expect(events).toContain('completed');

      const waitingIdx = events.indexOf('waiting');
      const activeIdx = events.indexOf('active');
      const completedIdx = events.indexOf('completed');
      expect(waitingIdx).toBeLessThan(activeIdx);
      expect(activeIdx).toBeLessThan(completedIdx);

      await worker.close();
    });
  });
});
