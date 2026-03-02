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
import { Queue, Worker } from '../src/classes';
import { removeAllQueueData } from '../src/utils';
import {
  LifecycleLogger,
  LifecycleLogEntry,
  LifecycleEvent,
} from '../src/interfaces';

describe('Lifecycle Logging', () => {
  const redisHost = process.env.REDIS_HOST || 'localhost';
  const prefix = process.env.BULLMQ_TEST_PREFIX || 'bull';

  let connection: IORedis;
  let queue: Queue;
  let worker: Worker;
  let queueName: string;

  function createMockLogger(): LifecycleLogger & {
    entries: LifecycleLogEntry[];
  } {
    const entries: LifecycleLogEntry[] = [];
    return {
      entries,
      debug(entry: LifecycleLogEntry) {
        entries.push(entry);
      },
      warn(entry: LifecycleLogEntry) {
        entries.push(entry);
      },
      error(entry: LifecycleLogEntry) {
        entries.push(entry);
      },
    };
  }

  beforeAll(async () => {
    connection = new IORedis(redisHost, { maxRetriesPerRequest: null });
  });

  beforeEach(async () => {
    queueName = `test-${v4()}`;
  });

  afterEach(async () => {
    if (worker) {
      await worker.close();
    }
    if (queue) {
      await queue.close();
    }
    await removeAllQueueData(new IORedis(redisHost), queueName);
  });

  afterAll(async () => {
    await connection.quit();
  });

  describe('VAL-01: Logger receives structured entries on job completion', () => {
    it('should log job:added, job:active, and job:completed entries', async () => {
      const logger = createMockLogger();

      queue = new Queue(queueName, {
        connection,
        prefix,
        logger,
      });

      worker = new Worker(
        queueName,
        async () => {
          return 'done';
        },
        { connection, prefix, logger },
      );

      const completed = new Promise<void>(resolve => {
        worker.on('completed', () => resolve());
      });

      await queue.add('test-job', { foo: 'bar' });
      await completed;

      const addedEntries = logger.entries.filter(e => e.event === 'job:added');
      expect(addedEntries.length).toBe(1);
      expect(addedEntries[0].queue).toBe(queueName);
      expect(addedEntries[0].jobId).toBeDefined();
      expect(addedEntries[0].jobName).toBe('test-job');
      expect(addedEntries[0].timestamp).toBeGreaterThan(0);

      const activeEntries = logger.entries.filter(
        e => e.event === 'job:active',
      );
      expect(activeEntries.length).toBe(1);
      expect(activeEntries[0].jobId).toBeDefined();
      expect(activeEntries[0].attemptsMade).toBeDefined();

      const completedEntries = logger.entries.filter(
        e => e.event === 'job:completed',
      );
      expect(completedEntries.length).toBe(1);
      expect(completedEntries[0].jobId).toBeDefined();
      expect(completedEntries[0].jobName).toBe('test-job');
      expect(completedEntries[0].duration).toBeGreaterThanOrEqual(0);
      expect(completedEntries[0].attemptsMade).toBeDefined();
    });
  });

  describe('VAL-02: Failed jobs log at error level with failure details', () => {
    it('should log job:failed with error details', async () => {
      const logger = createMockLogger();

      queue = new Queue(queueName, {
        connection,
        prefix,
        logger,
      });

      worker = new Worker(
        queueName,
        async () => {
          throw new Error('Processing failed');
        },
        { connection, prefix, logger, autorun: false },
      );

      const failed = new Promise<void>(resolve => {
        worker.on('failed', () => resolve());
      });

      await queue.add('failing-job', { data: 'test' });
      worker.run();
      await failed;

      const failedEntries = logger.entries.filter(
        e => e.event === 'job:failed',
      );
      expect(failedEntries.length).toBe(1);
      expect(failedEntries[0].jobId).toBeDefined();
      expect(failedEntries[0].jobName).toBe('failing-job');
      expect(failedEntries[0].attemptsMade).toBeDefined();
      expect(failedEntries[0].data).toBeDefined();
      expect(failedEntries[0].data.failedReason).toBe('Processing failed');
    });
  });

  describe('VAL-03: Retrying jobs log at warn level', () => {
    it('should log job:retrying when retry is scheduled', async () => {
      const logger = createMockLogger();

      queue = new Queue(queueName, {
        connection,
        prefix,
        logger,
      });

      let attemptCount = 0;
      worker = new Worker(
        queueName,
        async () => {
          attemptCount++;
          if (attemptCount === 1) {
            throw new Error('First attempt fails');
          }
          return 'done';
        },
        { connection, prefix, logger, autorun: false },
      );

      const completed = new Promise<void>(resolve => {
        worker.on('completed', () => resolve());
      });

      await queue.add('retry-job', { data: 'test' }, { attempts: 3 });
      worker.run();
      await completed;

      const retryEntries = logger.entries.filter(
        e => e.event === 'job:retrying',
      );
      expect(retryEntries.length).toBeGreaterThanOrEqual(1);
      expect(retryEntries[0].data).toBeDefined();
      expect(retryEntries[0].data.maxAttempts).toBe(3);
      expect(retryEntries[0].attemptsMade).toBeDefined();
    });
  });

  describe('VAL-05: No logging when logger is not configured', () => {
    it('should not produce any errors when no logger is set', async () => {
      queue = new Queue(queueName, {
        connection,
        prefix,
      });

      worker = new Worker(
        queueName,
        async () => {
          return 'done';
        },
        { connection, prefix, autorun: false },
      );

      const completed = new Promise<void>(resolve => {
        worker.on('completed', () => resolve());
      });

      await queue.add('test-job', { foo: 'bar' });
      worker.run();
      await completed;
    });
  });

  describe('VAL-06: Event filtering respects logEvents option', () => {
    it('should only log events specified in logEvents', async () => {
      const logger = createMockLogger();

      queue = new Queue(queueName, {
        connection,
        prefix,
        logger,
        logEvents: ['job:completed', 'job:failed'],
      });

      worker = new Worker(
        queueName,
        async () => {
          return 'done';
        },
        {
          connection,
          prefix,
          logger,
          logEvents: ['job:completed', 'job:failed'],
        },
      );

      const completed = new Promise<void>(resolve => {
        worker.on('completed', () => resolve());
      });

      await queue.add('filtered-job', { foo: 'bar' });
      await completed;

      const addedEntries = logger.entries.filter(e => e.event === 'job:added');
      expect(addedEntries.length).toBe(0);

      const activeEntries = logger.entries.filter(
        e => e.event === 'job:active',
      );
      expect(activeEntries.length).toBe(0);

      const completedEntries = logger.entries.filter(
        e => e.event === 'job:completed',
      );
      expect(completedEntries.length).toBe(1);
    });
  });

  describe('VAL-07: All lifecycle events fire correctly in a full cycle', () => {
    it('should log the correct sequence for a retry scenario', async () => {
      const logger = createMockLogger();

      queue = new Queue(queueName, {
        connection,
        prefix,
        logger,
      });

      let attemptCount = 0;
      worker = new Worker(
        queueName,
        async () => {
          attemptCount++;
          if (attemptCount === 1) {
            throw new Error('First attempt fails');
          }
          return 'success';
        },
        { connection, prefix, logger, autorun: false },
      );

      const completed = new Promise<void>(resolve => {
        worker.on('completed', () => resolve());
      });

      await queue.add('lifecycle-job', { data: 'test' }, { attempts: 2 });
      worker.run();
      await completed;

      const events = logger.entries.map(e => e.event);
      expect(events).toContain('job:added');
      expect(events).toContain('job:active');
      expect(events).toContain('job:retrying');
      expect(events).toContain('job:completed');

      logger.entries.forEach(entry => {
        expect(entry.timestamp).toBeGreaterThan(0);
        expect(entry.queue).toBe(queueName);
      });

      const jobIdEntries = logger.entries.filter(e => e.jobId);
      expect(jobIdEntries.length).toBeGreaterThan(0);
    });
  });

  describe('VAL-08: Logger interface is correctly exported', () => {
    it('should have LifecycleLogger, LifecycleLogEntry, and LifecycleEvent types available', () => {
      const logger: LifecycleLogger = {
        debug: (_entry: LifecycleLogEntry) => {},
        warn: (_entry: LifecycleLogEntry) => {},
        error: (_entry: LifecycleLogEntry) => {},
      };

      const event: LifecycleEvent = 'job:added';
      expect(event).toBe('job:added');
      expect(logger).toBeDefined();
    });
  });

  describe('VAL-10: Duration is accurately measured', () => {
    it('should report a duration close to actual processing time', async () => {
      const logger = createMockLogger();

      queue = new Queue(queueName, {
        connection,
        prefix,
        logger,
      });

      worker = new Worker(
        queueName,
        async () => {
          await new Promise(resolve => setTimeout(resolve, 100));
          return 'done';
        },
        { connection, prefix, logger, autorun: false },
      );

      const completed = new Promise<void>(resolve => {
        worker.on('completed', () => resolve());
      });

      await queue.add('duration-job', { data: 'test' });
      worker.run();
      await completed;

      const completedEntries = logger.entries.filter(
        e => e.event === 'job:completed',
      );
      expect(completedEntries.length).toBe(1);
      expect(completedEntries[0].duration).toBeGreaterThanOrEqual(80);
      expect(completedEntries[0].duration).toBeLessThan(500);
    });
  });
});
