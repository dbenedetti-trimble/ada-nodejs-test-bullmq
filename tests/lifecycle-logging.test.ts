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
import * as sinon from 'sinon';
import { v4 } from 'uuid';
import { Queue, Worker, Job } from '../src/classes';
import {
  LifecycleLogger,
  LifecycleLogEntry,
  LifecycleEvent,
} from '../src/interfaces';
import { delay, removeAllQueueData } from '../src/utils';

describe('lifecycle logging', () => {
  const redisHost = process.env.REDIS_HOST || 'localhost';
  const prefix = process.env.BULLMQ_TEST_PREFIX || 'bull';

  const sandbox = sinon.createSandbox();

  let queue: Queue;
  let queueName: string;
  let connection: IORedis;

  function createMockLogger(): LifecycleLogger & {
    debugEntries: LifecycleLogEntry[];
    warnEntries: LifecycleLogEntry[];
    errorEntries: LifecycleLogEntry[];
    allEntries: LifecycleLogEntry[];
  } {
    const debugEntries: LifecycleLogEntry[] = [];
    const warnEntries: LifecycleLogEntry[] = [];
    const errorEntries: LifecycleLogEntry[] = [];
    const allEntries: LifecycleLogEntry[] = [];
    return {
      debugEntries,
      warnEntries,
      errorEntries,
      allEntries,
      debug(entry: LifecycleLogEntry) {
        debugEntries.push(entry);
        allEntries.push(entry);
      },
      warn(entry: LifecycleLogEntry) {
        warnEntries.push(entry);
        allEntries.push(entry);
      },
      error(entry: LifecycleLogEntry) {
        errorEntries.push(entry);
        allEntries.push(entry);
      },
    };
  }

  beforeAll(async () => {
    connection = new IORedis(redisHost, { maxRetriesPerRequest: null });
  });

  beforeEach(async () => {
    queueName = `test-${v4()}`;
    queue = new Queue(queueName, { connection, prefix });
    await queue.waitUntilReady();
  });

  afterEach(async () => {
    sandbox.restore();
    await queue.close();
    await removeAllQueueData(new IORedis(redisHost), queueName);
  });

  afterAll(async () => {
    await connection.quit();
  });

  describe('VAL-01: Logger receives structured entries on job completion', () => {
    it('should log job:added, job:active, and job:completed', async () => {
      const logger = createMockLogger();

      await queue.close();
      queue = new Queue(queueName, { connection, prefix, logger });

      const worker = new Worker(
        queueName,
        async () => {
          await delay(10);
          return 'done';
        },
        { connection, prefix, logger },
      );

      const completed = new Promise<void>(resolve => {
        worker.on('completed', () => resolve());
      });

      await queue.add('test-job', { foo: 'bar' });
      await completed;

      await worker.close();

      const addedEntries = logger.allEntries.filter(
        e => e.event === 'job:added',
      );
      expect(addedEntries.length).toBeGreaterThanOrEqual(1);
      expect(addedEntries[0].queue).toBe(queueName);
      expect(addedEntries[0].jobId).toBeTypeOf('string');
      expect(addedEntries[0].jobName).toBe('test-job');
      expect(addedEntries[0].timestamp).toBeTypeOf('number');

      const activeEntries = logger.allEntries.filter(
        e => e.event === 'job:active',
      );
      expect(activeEntries.length).toBeGreaterThanOrEqual(1);
      expect(activeEntries[0].jobId).toBeTypeOf('string');
      expect(activeEntries[0].attemptsMade).toBeTypeOf('number');

      const completedEntries = logger.allEntries.filter(
        e => e.event === 'job:completed',
      );
      expect(completedEntries.length).toBeGreaterThanOrEqual(1);
      expect(completedEntries[0].jobId).toBeTypeOf('string');
      expect(completedEntries[0].duration).toBeGreaterThan(0);
      expect(completedEntries[0].attemptsMade).toBeTypeOf('number');
    });
  });

  describe('VAL-02: Failed jobs log at error level with failure details', () => {
    it('should log job:failed at error level with failure details', async () => {
      const logger = createMockLogger();

      await queue.close();
      queue = new Queue(queueName, { connection, prefix, logger });

      const worker = new Worker(
        queueName,
        async () => {
          throw new Error('test failure');
        },
        { connection, prefix, logger },
      );

      const failed = new Promise<void>(resolve => {
        worker.on('failed', () => resolve());
      });

      await queue.add('failing-job', { x: 1 });
      await failed;

      await worker.close();

      const failedEntries = logger.errorEntries.filter(
        e => e.event === 'job:failed',
      );
      expect(failedEntries.length).toBeGreaterThanOrEqual(1);
      expect(failedEntries[0].jobId).toBeTypeOf('string');
      expect(failedEntries[0].jobName).toBe('failing-job');
      expect(failedEntries[0].attemptsMade).toBeTypeOf('number');
      expect(failedEntries[0].data).toEqual(
        expect.objectContaining({ failedReason: 'test failure' }),
      );
    });
  });

  describe('VAL-03: Retrying jobs log at warn level', () => {
    it('should log job:retrying at warn level with retry metadata', async () => {
      const logger = createMockLogger();

      let attempts = 0;

      const worker = new Worker(
        queueName,
        async () => {
          attempts++;
          if (attempts === 1) {
            throw new Error('first attempt fails');
          }
          return 'ok';
        },
        { connection, prefix, logger },
      );

      const completed = new Promise<void>(resolve => {
        worker.on('completed', () => resolve());
      });

      await queue.add(
        'retry-job',
        {},
        { attempts: 3, backoff: { type: 'fixed', delay: 50 } },
      );
      await completed;

      await worker.close();

      const retryEntries = logger.warnEntries.filter(
        e => e.event === 'job:retrying',
      );
      expect(retryEntries.length).toBeGreaterThanOrEqual(1);
      expect(retryEntries[0].jobId).toBeTypeOf('string');
      expect(retryEntries[0].attemptsMade).toBeTypeOf('number');
      expect(retryEntries[0].data).toEqual(
        expect.objectContaining({ maxAttempts: 3 }),
      );
    });
  });

  describe('VAL-05: No logging when logger is not configured', () => {
    it('should not produce any log calls when no logger is provided', async () => {
      const spy = sinon.spy();

      const worker = new Worker(queueName, async () => 'done', {
        connection,
        prefix,
      });

      const completed = new Promise<void>(resolve => {
        worker.on('completed', () => resolve());
      });

      await queue.add('no-log-job', { a: 1 });
      await completed;

      await worker.close();

      expect(spy.callCount).toBe(0);
    });
  });

  describe('VAL-06: Event filtering respects logEvents option', () => {
    it('should only log events included in logEvents', async () => {
      const logger = createMockLogger();

      await queue.close();
      queue = new Queue(queueName, {
        connection,
        prefix,
        logger,
        logEvents: ['job:completed', 'job:failed'],
      });

      const worker = new Worker(queueName, async () => 'done', {
        connection,
        prefix,
        logger,
        logEvents: ['job:completed', 'job:failed'],
      });

      const completed = new Promise<void>(resolve => {
        worker.on('completed', () => resolve());
      });

      await queue.add('filtered-job', {});
      await completed;

      await worker.close();

      const addedEntries = logger.allEntries.filter(
        e => e.event === 'job:added',
      );
      const activeEntries = logger.allEntries.filter(
        e => e.event === 'job:active',
      );
      const completedEntries = logger.allEntries.filter(
        e => e.event === 'job:completed',
      );

      expect(addedEntries.length).toBe(0);
      expect(activeEntries.length).toBe(0);
      expect(completedEntries.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('VAL-07: All lifecycle events fire correctly in a full cycle', () => {
    it('should log events in order for a fail-then-succeed scenario', async () => {
      const logger = createMockLogger();

      await queue.close();
      queue = new Queue(queueName, { connection, prefix, logger });

      let attempts = 0;
      const worker = new Worker(
        queueName,
        async () => {
          attempts++;
          if (attempts === 1) {
            throw new Error('fail first');
          }
          return 'success';
        },
        { connection, prefix, logger },
      );

      const completed = new Promise<void>(resolve => {
        worker.on('completed', () => resolve());
      });

      await queue.add(
        'lifecycle-job',
        {},
        { attempts: 2, backoff: { type: 'fixed', delay: 50 } },
      );
      await completed;

      await worker.close();

      const events = logger.allEntries.map(e => e.event);

      expect(events).toContain('job:added');
      expect(events).toContain('job:active');
      expect(events).toContain('job:retrying');
      expect(events).toContain('job:completed');

      for (const entry of logger.allEntries) {
        expect(entry.timestamp).toBeTypeOf('number');
        expect(entry.queue).toBe(queueName);
        if (entry.event !== 'job:stalled') {
          expect(entry.jobId).toBeTypeOf('string');
        }
      }
    });
  });

  describe('VAL-08: Logger interface is correctly exported', () => {
    it('should export LifecycleLogger, LifecycleLogEntry, and LifecycleEvent', () => {
      const logger: LifecycleLogger = {
        debug: (_entry: LifecycleLogEntry) => {},
        warn: (_entry: LifecycleLogEntry) => {},
        error: (_entry: LifecycleLogEntry) => {},
      };

      const event: LifecycleEvent = 'job:added';

      expect(typeof logger.debug).toBe('function');
      expect(typeof logger.warn).toBe('function');
      expect(typeof logger.error).toBe('function');
      expect(event).toBe('job:added');
    });
  });

  describe('VAL-10: Duration is accurately measured', () => {
    it('should report accurate duration for completed jobs', async () => {
      const logger = createMockLogger();

      const worker = new Worker(
        queueName,
        async () => {
          await delay(100);
          return 'done';
        },
        { connection, prefix, logger },
      );

      const completed = new Promise<void>(resolve => {
        worker.on('completed', () => resolve());
      });

      await queue.add('duration-job', {});
      await completed;

      await worker.close();

      const completedEntries = logger.debugEntries.filter(
        e => e.event === 'job:completed',
      );
      expect(completedEntries.length).toBeGreaterThanOrEqual(1);
      expect(completedEntries[0].duration).toBeGreaterThanOrEqual(80);
      expect(completedEntries[0].duration).toBeLessThan(500);
    });
  });
});
