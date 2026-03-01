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
function createMockLogger(): LifecycleLogger & {
  calls: { level: string; entry: LifecycleLogEntry }[];
} {
  const calls: { level: string; entry: LifecycleLogEntry }[] = [];
  return {
    calls,
    debug(entry: LifecycleLogEntry) {
      calls.push({ level: 'debug', entry });
    },
    warn(entry: LifecycleLogEntry) {
      calls.push({ level: 'warn', entry });
    },
    error(entry: LifecycleLogEntry) {
      calls.push({ level: 'error', entry });
    },
  };
}

describe('Lifecycle Logging', () => {
  const redisHost = process.env.REDIS_HOST || 'localhost';
  const prefix = process.env.BULLMQ_TEST_PREFIX || 'bull';

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

  it('VAL-01: logger.debug called for job:added, job:active, job:completed on successful job', async () => {
    const logger = createMockLogger();

    const workerQueue = new Queue(queueName, {
      connection,
      prefix,
      logger,
    });

    const worker = new Worker(
      queueName,
      async () => {
        return 'done';
      },
      { connection, prefix, logger },
    );

    await worker.waitUntilReady();

    const job = await workerQueue.add('test-job', { foo: 'bar' });

    await new Promise<void>(resolve => {
      worker.on('completed', () => resolve());
    });

    await worker.close();
    await workerQueue.close();

    const events = logger.calls.map(c => c.entry.event);
    expect(events).toContain('job:added');
    expect(events).toContain('job:active');
    expect(events).toContain('job:completed');

    const addedEntry = logger.calls.find(
      c => c.entry.event === 'job:added',
    )!.entry;
    expect(addedEntry.queue).toBe(queueName);
    expect(addedEntry.jobId).toBe(job.id);
    expect(addedEntry.jobName).toBe('test-job');
    expect(typeof addedEntry.timestamp).toBe('number');

    const activeEntry = logger.calls.find(
      c => c.entry.event === 'job:active',
    )!.entry;
    expect(activeEntry.queue).toBe(queueName);
    expect(activeEntry.jobId).toBe(job.id);

    const completedEntry = logger.calls.find(
      c => c.entry.event === 'job:completed',
    )!.entry;
    expect(completedEntry.queue).toBe(queueName);
    expect(completedEntry.jobId).toBe(job.id);
    expect(typeof completedEntry.attemptsMade).toBe('number');
  });

  it('VAL-02: logger.error called for job:failed with failedReason in data', async () => {
    const logger = createMockLogger();

    const worker = new Worker(
      queueName,
      async () => {
        throw new Error('intentional failure');
      },
      {
        connection,
        prefix,
        logger,
      },
    );

    await worker.waitUntilReady();

    await queue.add('test-job', { foo: 'bar' }, { attempts: 1 });

    await new Promise<void>(resolve => {
      worker.on('failed', () => resolve());
    });

    await worker.close();

    const failedCalls = logger.calls.filter(
      c => c.entry.event === 'job:failed',
    );
    expect(failedCalls.length).toBeGreaterThan(0);

    const failedEntry = failedCalls[0].entry;
    expect(failedCalls[0].level).toBe('error');
    expect(failedEntry.queue).toBe(queueName);
    expect(typeof failedEntry.jobId).toBe('string');
    expect(failedEntry.jobName).toBe('test-job');
    expect(failedEntry.data?.failedReason).toBe('intentional failure');
    expect(typeof failedEntry.attemptsMade).toBe('number');
  });

  it('VAL-03: logger.warn called for job:retrying with attemptsMade/delay/maxAttempts', async () => {
    const logger = createMockLogger();

    let attemptCount = 0;
    const worker = new Worker(
      queueName,
      async () => {
        attemptCount++;
        if (attemptCount === 1) {
          throw new Error('first attempt failure');
        }
        return 'done';
      },
      {
        connection,
        prefix,
        logger,
      },
    );

    await worker.waitUntilReady();

    await queue.add('retry-job', { foo: 'bar' }, { attempts: 3 });

    await new Promise<void>(resolve => {
      worker.on('completed', () => resolve());
    });

    await worker.close();

    const retryCalls = logger.calls.filter(
      c => c.entry.event === 'job:retrying',
    );
    expect(retryCalls.length).toBeGreaterThan(0);

    const retryEntry = retryCalls[0].entry;
    expect(retryCalls[0].level).toBe('warn');
    expect(retryEntry.queue).toBe(queueName);
    expect(typeof retryEntry.attemptsMade).toBe('number');
    expect(retryEntry.data?.maxAttempts).toBe(3);
  });

  it('VAL-04: logger.warn called for job:stalled', async () => {
    const logger = createMockLogger();

    const worker = new Worker(
      queueName,
      async () => {
        return delay(10000);
      },
      {
        connection,
        prefix,
        logger,
        lockDuration: 100,
        stalledInterval: 50,
      },
    );

    await worker.waitUntilReady();

    await queue.add('stall-job', {});

    const activePromise = new Promise<void>(resolve => {
      worker.on('active', () => resolve());
    });

    await activePromise;
    await worker.close(true);

    const worker2 = new Worker(queueName, async () => 'done', {
      connection,
      prefix,
      logger,
      stalledInterval: 50,
    });

    await new Promise<void>(resolve => {
      worker2.on('stalled', () => resolve());
    });

    await worker2.close();

    const stalledCalls = logger.calls.filter(
      c => c.entry.event === 'job:stalled',
    );
    expect(stalledCalls.length).toBeGreaterThan(0);
    expect(stalledCalls[0].level).toBe('warn');
    expect(stalledCalls[0].entry.queue).toBe(queueName);
    expect(typeof stalledCalls[0].entry.jobId).toBe('string');
  });

  it('VAL-05: no logging when logger is not configured', async () => {
    const worker = new Worker(
      queueName,
      async () => {
        throw new Error('fail');
      },
      {
        connection,
        prefix,
      },
    );

    await worker.waitUntilReady();

    await queue.add('test-job', {}, { attempts: 1 });

    await new Promise<void>(resolve => {
      worker.on('failed', () => resolve());
    });

    await worker.close();
  });

  it('VAL-06: logEvents filter – only listed events produce log calls', async () => {
    const logger = createMockLogger();

    const workerQueue = new Queue(queueName, {
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

    await worker.waitUntilReady();

    await workerQueue.add('filter-job', {});

    await new Promise<void>(resolve => {
      worker.on('completed', () => resolve());
    });

    await worker.close();
    await workerQueue.close();

    const events = logger.calls.map(c => c.entry.event);
    expect(events).toContain('job:completed');
    expect(events).not.toContain('job:added');
    expect(events).not.toContain('job:active');
  });

  it('VAL-07: full cycle fail-then-succeed logs events in order', async () => {
    const logger = createMockLogger();

    let attemptCount = 0;

    const workerQueue = new Queue(queueName, {
      connection,
      prefix,
      logger,
    });

    const worker = new Worker(
      queueName,
      async () => {
        attemptCount++;
        if (attemptCount === 1) {
          throw new Error('first attempt');
        }
        return 'success';
      },
      {
        connection,
        prefix,
        logger,
      },
    );

    await worker.waitUntilReady();

    await workerQueue.add('cycle-job', {}, { attempts: 2 });

    await new Promise<void>(resolve => {
      worker.on('completed', () => resolve());
    });

    await worker.close();
    await workerQueue.close();

    const events = logger.calls.map(c => c.entry.event);

    const addedIdx = events.indexOf('job:added');
    const firstActiveIdx = events.indexOf('job:active');
    const retryingIdx = events.indexOf('job:retrying');
    const completedIdx = events.lastIndexOf('job:completed');

    expect(addedIdx).toBeGreaterThanOrEqual(0);
    expect(firstActiveIdx).toBeGreaterThan(addedIdx);
    expect(retryingIdx).toBeGreaterThan(firstActiveIdx);
    expect(completedIdx).toBeGreaterThan(retryingIdx);

    const entries = logger.calls.map(c => c.entry);
    for (const entry of entries) {
      expect(typeof entry.timestamp).toBe('number');
      expect(entry.queue).toBe(queueName);
      expect(typeof entry.jobId).toBe('string');
    }
  });

  it('VAL-10: duration on job:completed is within expected range for timed processor', async () => {
    const logger = createMockLogger();

    const worker = new Worker(
      queueName,
      async () => {
        await delay(100);
        return 'done';
      },
      {
        connection,
        prefix,
        logger,
      },
    );

    await worker.waitUntilReady();

    await queue.add('timed-job', {});

    await new Promise<void>(resolve => {
      worker.on('completed', () => resolve());
    });

    await worker.close();

    const completedCall = logger.calls.find(
      c => c.entry.event === 'job:completed',
    );
    expect(completedCall).toBeDefined();
    expect(completedCall!.entry.duration).toBeDefined();
    expect(completedCall!.entry.duration).toBeGreaterThanOrEqual(80);
    expect(completedCall!.entry.duration).toBeLessThan(2000);
  });
});
