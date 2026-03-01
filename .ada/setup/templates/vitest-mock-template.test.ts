/**
 * BullMQ Mock/Stub Test Template
 *
 * Tests demonstrating mocking patterns for BullMQ tests.
 * While Redis and BullMQ core classes should always be real,
 * external dependencies (HTTP APIs, file system, timers)
 * should be mocked using Sinon or Vitest mocking utilities.
 *
 * Key patterns:
 * - Use Sinon for spies, stubs, and fakes
 * - Use Vitest vi.fn() for simple mocks
 * - Restore all stubs in afterEach to prevent leaks
 * - Use fake timers for time-dependent tests
 * - Never mock Redis or BullMQ internal classes
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
  vi,
} from 'vitest';
import * as sinon from 'sinon';
import { v4 } from 'uuid';
import { Queue, Worker, Job, QueueEvents } from '../src/classes';
import { removeAllQueueData, delay } from '../src/utils';

describe('[FEATURE_NAME] - Mocking Patterns', () => {
  const redisHost = process.env.REDIS_HOST || 'localhost';
  const prefix = process.env.BULLMQ_TEST_PREFIX || 'bull';

  let queue: Queue;
  let queueName: string;
  let sandbox: sinon.SinonSandbox;

  let connection: IORedis;
  beforeAll(async () => {
    connection = new IORedis(redisHost, { maxRetriesPerRequest: null });
  });

  beforeEach(async () => {
    queueName = `test-${v4()}`;
    queue = new Queue(queueName, { connection, prefix });
    sandbox = sinon.createSandbox();
  });

  afterEach(async () => {
    sandbox.restore();
    await queue.close();
    await removeAllQueueData(new IORedis(redisHost), queueName);
  });

  afterAll(async () => {
    await connection.quit();
  });

  describe('sinon spy patterns', () => {
    it('should verify processor was called with correct arguments', async () => {
      const processorSpy = sandbox.spy();

      let resolveProcessing: () => void;
      const processing = new Promise<void>(resolve => {
        resolveProcessing = resolve;
      });

      const worker = new Worker(
        queueName,
        async (job: Job) => {
          processorSpy(job.name, job.data);
          resolveProcessing();
          return 'done';
        },
        { connection, prefix },
      );
      await worker.waitUntilReady();

      await queue.add('my-job', { key: 'value' });
      await processing;

      expect(processorSpy.calledOnce).toBe(true);
      expect(processorSpy.firstCall.args[0]).toBe('my-job');
      expect(processorSpy.firstCall.args[1]).toEqual({ key: 'value' });

      await worker.close();
    });

    it('should track multiple processor invocations', async () => {
      const processorSpy = sandbox.spy();
      let processedCount = 0;

      const allProcessed = new Promise<void>(resolve => {
        const worker = new Worker(
          queueName,
          async (job: Job) => {
            processorSpy(job.data.index);
            processedCount++;
            if (processedCount === 3) {
              resolve();
            }
          },
          { connection, prefix },
        );
        worker.waitUntilReady();
      });

      await queue.add('job-1', { index: 0 });
      await queue.add('job-2', { index: 1 });
      await queue.add('job-3', { index: 2 });

      await allProcessed;

      expect(processorSpy.callCount).toBe(3);
      const calledWith = processorSpy.getCalls().map(c => c.args[0]);
      expect(calledWith).toContain(0);
      expect(calledWith).toContain(1);
      expect(calledWith).toContain(2);
    });
  });

  describe('sinon stub patterns', () => {
    it('should mock an external service called during processing', async () => {
      const externalService = {
        async sendNotification(jobId: string, status: string) {
          throw new Error('Should not reach real service');
        },
      };

      const stub = sandbox
        .stub(externalService, 'sendNotification')
        .resolves({ sent: true });

      let resolveProcessing: () => void;
      const processing = new Promise<void>(resolve => {
        resolveProcessing = resolve;
      });

      const worker = new Worker(
        queueName,
        async (job: Job) => {
          await externalService.sendNotification(job.id!, 'completed');
          resolveProcessing();
          return 'done';
        },
        { connection, prefix },
      );
      await worker.waitUntilReady();

      const job = await queue.add('test', { data: 'value' });
      await processing;

      expect(stub.calledOnce).toBe(true);
      expect(stub.firstCall.args[0]).toBe(job.id);
      expect(stub.firstCall.args[1]).toBe('completed');

      await worker.close();
    });
  });

  describe('vitest mock patterns', () => {
    it('should use vi.fn() for simple callback tracking', async () => {
      const onCompleted = vi.fn();

      const queueEvents = new QueueEvents(queueName, { connection, prefix });
      await queueEvents.waitUntilReady();

      const completed = new Promise<void>(resolve => {
        queueEvents.on('completed', event => {
          onCompleted(event.jobId);
          resolve();
        });
      });

      const worker = new Worker(queueName, async () => 'done', {
        connection,
        prefix,
      });
      await worker.waitUntilReady();

      const job = await queue.add('test', { data: 'value' });
      await completed;

      expect(onCompleted).toHaveBeenCalledTimes(1);
      expect(onCompleted).toHaveBeenCalledWith(job.id);

      await worker.close();
      await queueEvents.close();
    });
  });

  describe('fake timer patterns', () => {
    it('should use sinon fake timers for delayed operations', async () => {
      const clock = sandbox.useFakeTimers({
        now: Date.now(),
        shouldAdvanceTime: true,
      });

      const job = await queue.add(
        'delayed-job',
        { data: 'test' },
        { delay: 10000 },
      );

      const jobState = await job.getState();
      expect(jobState).toBe('delayed');

      clock.restore();
    });
  });

  describe('error simulation patterns', () => {
    it('should simulate intermittent failures', async () => {
      let callCount = 0;

      const queueEvents = new QueueEvents(queueName, { connection, prefix });
      await queueEvents.waitUntilReady();

      const completed = new Promise<void>(resolve => {
        queueEvents.on('completed', () => resolve());
      });

      const worker = new Worker(
        queueName,
        async (job: Job) => {
          callCount++;
          if (callCount < 3) {
            throw new Error(`Simulated failure #${callCount}`);
          }
          return 'success';
        },
        { connection, prefix },
      );
      await worker.waitUntilReady();

      await queue.add('flaky-job', { data: 'test' }, { attempts: 5 });
      await completed;

      expect(callCount).toBe(3);

      await worker.close();
      await queueEvents.close();
    });
  });
});
