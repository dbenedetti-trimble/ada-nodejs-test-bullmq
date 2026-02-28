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
import { removeAllQueueData, delay } from '../src/utils';
import {
  LifecycleLogger,
  LifecycleLogEntry,
  LifecycleEvent,
} from '../src/interfaces';

describe('Lifecycle Logging', () => {
  const redisHost = process.env.REDIS_HOST || 'localhost';
  const prefix = process.env.BULLMQ_TEST_PREFIX || 'bull';

  class MockLogger implements LifecycleLogger {
    debugCalls: LifecycleLogEntry[] = [];
    warnCalls: LifecycleLogEntry[] = [];
    errorCalls: LifecycleLogEntry[] = [];

    debug(entry: LifecycleLogEntry): void {
      this.debugCalls.push(entry);
    }

    warn(entry: LifecycleLogEntry): void {
      this.warnCalls.push(entry);
    }

    error(entry: LifecycleLogEntry): void {
      this.errorCalls.push(entry);
    }

    reset() {
      this.debugCalls = [];
      this.warnCalls = [];
      this.errorCalls = [];
    }

    allCalls(): LifecycleLogEntry[] {
      return [...this.debugCalls, ...this.warnCalls, ...this.errorCalls].sort(
        (a, b) => a.timestamp - b.timestamp,
      );
    }
  }

  let connection: IORedis;
  let queueName: string;
  let queue: Queue;

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

  it('logs job:added, job:active, and job:completed for a successful job (VAL-01)', async () => {
    const logger = new MockLogger();
    const loggedQueue = new Queue(queueName, { connection, prefix, logger });
    const worker = new Worker(queueName, async () => {}, {
      connection,
      prefix,
      logger,
    });

    try {
      const job = await loggedQueue.add('testJob', { x: 1 });
      await new Promise<void>(resolve => worker.on('completed', () => resolve()));

      const added = logger.debugCalls.find(e => e.event === 'job:added');
      expect(added).toBeDefined();
      expect(added!.jobId).toBe(job.id);
      expect(added!.queue).toBe(queueName);
      expect(added!.jobName).toBe('testJob');
      expect(typeof added!.timestamp).toBe('number');

      const active = logger.debugCalls.find(e => e.event === 'job:active');
      expect(active).toBeDefined();
      expect(active!.attemptsMade).toBeGreaterThanOrEqual(0);
      expect(active!.queue).toBe(queueName);

      const completed = logger.debugCalls.find(e => e.event === 'job:completed');
      expect(completed).toBeDefined();
      expect(completed!.duration).toBeGreaterThan(0);
      expect(completed!.attemptsMade).toBeDefined();
      expect(completed!.queue).toBe(queueName);
    } finally {
      await worker.close();
      await loggedQueue.close();
    }
  }, 15000);

  it('logs job:failed at error level with failedReason in data (VAL-02)', async () => {
    const logger = new MockLogger();
    const worker = new Worker(
      queueName,
      async () => {
        throw new Error('boom');
      },
      { connection, prefix, logger },
    );

    try {
      await queue.add('failJob', {});
      await new Promise<void>(resolve => worker.on('failed', () => resolve()));

      expect(logger.errorCalls).toHaveLength(1);
      const entry = logger.errorCalls[0];
      expect(entry.event).toBe('job:failed');
      expect(entry.data?.failedReason).toBe('boom');
      expect(entry.attemptsMade).toBeDefined();
      expect(entry.queue).toBe(queueName);
    } finally {
      await worker.close();
    }
  }, 15000);

  it('logs job:retrying at warn level when job is configured with attempts > 1 (VAL-03)', async () => {
    const logger = new MockLogger();
    let attempt = 0;
    const worker = new Worker(
      queueName,
      async () => {
        if (attempt++ === 0) throw new Error('first fail');
      },
      { connection, prefix, logger },
    );

    try {
      await queue.add('retryJob', {}, { attempts: 3 });
      await new Promise<void>(resolve => worker.on('completed', () => resolve()));

      const retrying = logger.warnCalls.find(e => e.event === 'job:retrying');
      expect(retrying).toBeDefined();
      expect(retrying!.data?.maxAttempts).toBe(3);
      expect(retrying!.queue).toBe(queueName);
    } finally {
      await worker.close();
    }
  }, 15000);

  it('logs job:stalled at warn level when job lock expires (VAL-04)', async () => {
    const logger = new MockLogger();
    const worker = new Worker(
      queueName,
      async () => delay(5000),
      {
        connection,
        prefix,
        logger,
        lockDuration: 1000,
        stalledInterval: 500,
        maxStalledCount: 0,
      },
    );

    try {
      await queue.add('stalledJob', {});
      await new Promise<void>(resolve =>
        setTimeout(async () => {
          resolve();
        }, 2500),
      );

      const stalled = logger.warnCalls.find(e => e.event === 'job:stalled');
      expect(stalled).toBeDefined();
      expect(stalled!.jobId).toBeDefined();
      expect(stalled!.queue).toBe(queueName);
    } finally {
      await worker.close();
    }
  }, 15000);

  it('produces no log calls and no errors when no logger is configured (VAL-05)', async () => {
    const worker = new Worker(queueName, async () => {}, { connection, prefix });

    try {
      await queue.add('noLogJob', {});
      await new Promise<void>(resolve => worker.on('completed', () => resolve()));
    } finally {
      await worker.close();
    }
  }, 15000);

  it('only logs events present in logEvents filter (VAL-06)', async () => {
    const logger = new MockLogger();
    const loggedQueue = new Queue(queueName, {
      connection,
      prefix,
      logger,
      logEvents: ['job:completed', 'job:failed'],
    });
    const worker = new Worker(queueName, async () => {}, {
      connection,
      prefix,
      logger,
      logEvents: ['job:completed', 'job:failed'],
    });

    try {
      await loggedQueue.add('filteredJob', {});
      await new Promise<void>(resolve => worker.on('completed', () => resolve()));

      expect(logger.debugCalls.find(e => e.event === 'job:added')).toBeUndefined();
      expect(logger.debugCalls.find(e => e.event === 'job:active')).toBeUndefined();
      expect(logger.debugCalls.find(e => e.event === 'job:completed')).toBeDefined();
    } finally {
      await worker.close();
      await loggedQueue.close();
    }
  }, 15000);

  it('emits events in correct order across retry cycle (VAL-07)', async () => {
    const logger = new MockLogger();
    let attempt = 0;
    const worker = new Worker(
      queueName,
      async () => {
        if (attempt++ === 0) throw new Error('fail first');
      },
      { connection, prefix, logger },
    );

    try {
      await queue.add('cycleJob', {}, { attempts: 2 });
      await new Promise<void>(resolve => worker.on('completed', () => resolve()));

      const events = logger.allCalls().map(e => e.event);
      expect(events).toContain('job:added');
      expect(events).toContain('job:active');
      expect(events).toContain('job:completed');
      expect(events.indexOf('job:completed')).toBeGreaterThan(
        events.indexOf('job:active'),
      );
    } finally {
      await worker.close();
    }
  }, 15000);

  it('LifecycleLogger, LifecycleLogEntry, and LifecycleEvent are importable from src (VAL-08)', () => {
    const logger: LifecycleLogger = new MockLogger();
    const entry: LifecycleLogEntry = {
      timestamp: Date.now(),
      event: 'job:added',
      queue: 'test',
    };
    const event: LifecycleEvent = 'job:completed';
    expect(logger).toBeDefined();
    expect(entry.event).toBe('job:added');
    expect(event).toBe('job:completed');
  });

  it('completed entry has duration within expected range for ~100ms processor (VAL-10)', async () => {
    const logger = new MockLogger();
    const worker = new Worker(
      queueName,
      async () => {
        await delay(100);
      },
      { connection, prefix, logger },
    );

    try {
      await queue.add('timedJob', {});
      await new Promise<void>(resolve => worker.on('completed', () => resolve()));

      const completed = logger.debugCalls.find(e => e.event === 'job:completed');
      expect(completed).toBeDefined();
      expect(completed!.duration).toBeGreaterThan(80);
      expect(completed!.duration).toBeLessThan(500);
    } finally {
      await worker.close();
    }
  }, 15000);

  it('shouldLog returns false for events not in logEvents — unit test', async () => {
    const filteredQueue = new Queue(queueName, {
      connection,
      prefix,
      logger: new MockLogger(),
      logEvents: ['job:completed'],
    });

    try {
      const base = filteredQueue as any;
      expect(base.shouldLog('job:added')).toBe(false);
      expect(base.shouldLog('job:completed')).toBe(true);
      expect(base.shouldLog('job:failed')).toBe(false);

      const noLogQueue = new Queue(`${queueName}-nolog`, { connection, prefix });
      try {
        expect((noLogQueue as any).shouldLog('job:completed')).toBe(false);
      } finally {
        await noLogQueue.close();
      }

      const allEventsQueue = new Queue(`${queueName}-all`, {
        connection,
        prefix,
        logger: new MockLogger(),
      });
      try {
        expect((allEventsQueue as any).shouldLog('job:added')).toBe(true);
      } finally {
        await allEventsQueue.close();
      }
    } finally {
      await filteredQueue.close();
    }
  }, 15000);
});
