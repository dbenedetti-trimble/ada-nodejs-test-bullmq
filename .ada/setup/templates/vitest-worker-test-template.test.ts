/**
 * BullMQ Worker Test Template
 *
 * Tests for Worker processing, lifecycle management, and error handling.
 * Workers are the core processing unit in BullMQ, handling job execution,
 * lock management, and stall detection.
 *
 * Key patterns:
 * - Promise-based resolution for async worker processing
 * - Worker.waitUntilReady() before adding jobs
 * - Always close workers in afterEach
 * - Use delay() for timing-sensitive tests
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

describe('[FEATURE_NAME] - Worker Processing', () => {
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

  describe('basic processing', () => {
    it('should process a single job', async () => {
      let processor;
      const processing = new Promise<void>(
        resolve =>
          (processor = async (job: Job) => {
            expect(job.data.foo).toBe('bar');
            resolve();
          }),
      );

      const worker = new Worker(queueName, processor, { connection, prefix });
      await worker.waitUntilReady();

      await queue.add('test', { foo: 'bar' });
      await processing;

      await worker.close();
    });

    it('should process multiple jobs sequentially', async () => {
      const processedJobs: string[] = [];
      let processor;
      const allProcessed = new Promise<void>(
        resolve =>
          (processor = async (job: Job) => {
            processedJobs.push(job.data.name);
            if (processedJobs.length === 3) {
              resolve();
            }
          }),
      );

      const worker = new Worker(queueName, processor, { connection, prefix });
      await worker.waitUntilReady();

      await queue.add('job1', { name: 'first' });
      await queue.add('job2', { name: 'second' });
      await queue.add('job3', { name: 'third' });

      await allProcessed;

      expect(processedJobs).toHaveLength(3);
      expect(processedJobs).toContain('first');
      expect(processedJobs).toContain('second');
      expect(processedJobs).toContain('third');

      await worker.close();
    });

    it('should return a result from the processor', async () => {
      const queueEvents = new QueueEvents(queueName, { connection, prefix });
      await queueEvents.waitUntilReady();

      const worker = new Worker(
        queueName,
        async (job: Job) => {
          return { processed: true, input: job.data.value };
        },
        { connection, prefix },
      );
      await worker.waitUntilReady();

      const job = await queue.add('test', { value: 42 });
      const result = await job.waitUntilFinished(queueEvents);

      expect(result).toEqual({ processed: true, input: 42 });

      await worker.close();
      await queueEvents.close();
    });
  });

  describe('error handling', () => {
    it('should handle job failure', async () => {
      const queueEvents = new QueueEvents(queueName, { connection, prefix });
      await queueEvents.waitUntilReady();

      const failedReason = 'Intentional test failure';

      const failing = new Promise<void>((resolve) => {
        queueEvents.on('failed', ({ failedReason: reason }) => {
          expect(reason).toBe(failedReason);
          resolve();
        });
      });

      const worker = new Worker(
        queueName,
        async () => {
          throw new Error(failedReason);
        },
        { connection, prefix, autorun: true },
      );
      await worker.waitUntilReady();

      await queue.add('failing-job', { data: 'test' });

      await failing;

      await worker.close();
      await queueEvents.close();
    });

    it('should retry failed jobs', async () => {
      let attempts = 0;
      let processor;
      const processing = new Promise<void>(
        resolve =>
          (processor = async (job: Job) => {
            attempts++;
            if (attempts < 3) {
              throw new Error(`Attempt ${attempts} failed`);
            }
            resolve();
          }),
      );

      const worker = new Worker(queueName, processor, { connection, prefix });
      await worker.waitUntilReady();

      await queue.add('retry-job', { data: 'test' }, { attempts: 3 });

      await processing;
      expect(attempts).toBe(3);

      await worker.close();
    });
  });

  describe('worker lifecycle', () => {
    it('should pause and resume processing', async () => {
      const processedBeforePause: string[] = [];
      const processedAfterResume: string[] = [];
      let isPaused = false;

      const worker = new Worker(
        queueName,
        async (job: Job) => {
          if (isPaused) {
            processedAfterResume.push(job.id!);
          } else {
            processedBeforePause.push(job.id!);
          }
        },
        { connection, prefix },
      );
      await worker.waitUntilReady();

      await queue.add('before-pause', { data: 'test' });
      await delay(500);

      await worker.pause();
      isPaused = true;

      await queue.add('during-pause', { data: 'test' });
      await delay(500);

      expect(processedBeforePause.length).toBeGreaterThanOrEqual(1);
      const countDuringPause = processedAfterResume.length;

      worker.resume();
      await delay(1000);

      expect(processedAfterResume.length).toBeGreaterThan(countDuringPause);

      await worker.close();
    });

    it('should close gracefully', async () => {
      const worker = new Worker(
        queueName,
        async () => {
          await delay(100);
          return 'done';
        },
        { connection, prefix },
      );
      await worker.waitUntilReady();

      await queue.add('test', { data: 'test' });
      await delay(200);

      await expect(worker.close()).resolves.toBeUndefined();
    });
  });

  describe('concurrency', () => {
    it('should process jobs with concurrency limit', async () => {
      const concurrencyLimit = 3;
      let currentActive = 0;
      let maxActive = 0;
      let completedCount = 0;

      const allDone = new Promise<void>((resolve) => {
        const worker = new Worker(
          queueName,
          async () => {
            currentActive++;
            maxActive = Math.max(maxActive, currentActive);
            await delay(200);
            currentActive--;
            completedCount++;
            if (completedCount === 6) {
              resolve();
            }
          },
          { connection, prefix, concurrency: concurrencyLimit },
        );
        worker.waitUntilReady();
      });

      for (let i = 0; i < 6; i++) {
        await queue.add(`job-${i}`, { index: i });
      }

      await allDone;

      expect(maxActive).toBeLessThanOrEqual(concurrencyLimit);
      expect(completedCount).toBe(6);
    });
  });
});
