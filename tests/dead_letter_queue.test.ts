import { default as IORedis } from 'ioredis';
import {
  describe,
  beforeAll,
  beforeEach,
  afterEach,
  afterAll,
  it,
  expect,
} from 'vitest';
import { v4 } from 'uuid';
import { Queue, Worker, QueueEvents, UnrecoverableError } from '../src/classes';
import { removeAllQueueData } from '../src/utils';

describe('Dead Letter Queue', () => {
  const redisHost = process.env.REDIS_HOST || 'localhost';
  const prefix = process.env.BULLMQ_TEST_PREFIX || 'bull';
  let connection: IORedis;
  let queue: Queue;
  let dlqQueue: Queue;
  let queueName: string;
  let dlqName: string;

  beforeAll(async () => {
    connection = new IORedis(redisHost, { maxRetriesPerRequest: null });
  });

  beforeEach(async () => {
    queueName = `test-${v4()}`;
    dlqName = `${queueName}-dlq`;
    queue = new Queue(queueName, { connection, prefix });
    dlqQueue = new Queue(dlqName, { connection, prefix });
  });

  afterEach(async () => {
    await queue.close();
    await dlqQueue.close();
    await removeAllQueueData(new IORedis(redisHost), queueName);
    await removeAllQueueData(new IORedis(redisHost), dlqName);
  });

  afterAll(async () => {
    await connection.quit();
  });

  // VAL-02, VAL-06: retry exhaustion routes to DLQ with full metadata
  it('routes job to DLQ after exhausting retries', async () => {
    await queue.add('test-job', { orderId: 123 }, { attempts: 3 });

    const worker = new Worker(
      queueName,
      async () => {
        throw new Error('Connection refused');
      },
      { connection, prefix, deadLetterQueue: { queueName: dlqName } },
    );
    await worker.waitUntilReady();

    await new Promise<void>(resolve => {
      worker.on('failed', (job, _err) => {
        if (job && job.attemptsMade >= 3) {
          resolve();
        }
      });
    });
    await worker.close();

    const count = await dlqQueue.getDeadLetterCount();
    expect(count).toBe(1);

    const [dlqJob] = await dlqQueue.getDeadLetterJobs(0, 0);
    expect(dlqJob).toBeDefined();
    expect(dlqJob.data.orderId).toBe(123);

    const meta = dlqJob.data._dlqMeta;
    expect(meta.sourceQueue).toBe(queueName);
    expect(meta.attemptsMade).toBe(3);
    expect(meta.failedReason).toBe('Connection refused');
    expect(Array.isArray(meta.stacktrace)).toBe(true);
    expect(meta.stacktrace.length).toBeGreaterThanOrEqual(1);
    expect(meta.deadLetteredAt).toBeTypeOf('number');
    expect(meta.originalOpts.attempts).toBe(3);
    expect(dlqJob.name).toBe('test-job');
  });

  // VAL-03: UnrecoverableError goes directly to DLQ on first attempt
  it('routes job to DLQ immediately on UnrecoverableError', async () => {
    await queue.add('email-job', { to: 'a@b.com' }, { attempts: 5 });

    const worker = new Worker(
      queueName,
      async () => {
        throw new UnrecoverableError('Invalid payload');
      },
      { connection, prefix, deadLetterQueue: { queueName: dlqName } },
    );
    await worker.waitUntilReady();

    await new Promise<void>(resolve => {
      worker.on('failed', () => resolve());
    });
    await worker.close();

    const count = await dlqQueue.getDeadLetterCount();
    expect(count).toBe(1);

    const [dlqJob] = await dlqQueue.getDeadLetterJobs(0, 0);
    expect(dlqJob.data._dlqMeta.attemptsMade).toBe(1);
  });

  // VAL-04: successful job does NOT go to DLQ
  it('does not route successful job to DLQ', async () => {
    await queue.add('ok-job', {});

    const worker = new Worker(queueName, async () => {}, {
      connection,
      prefix,
      deadLetterQueue: { queueName: dlqName },
    });
    await worker.waitUntilReady();

    await new Promise<void>(resolve => {
      worker.on('completed', () => resolve());
    });
    await worker.close();

    expect(await dlqQueue.getDeadLetterCount()).toBe(0);
  });

  // VAL-01: no DLQ configured preserves existing failed-set behavior
  it('preserves existing failed-set behavior when deadLetterQueue not configured', async () => {
    await queue.add('fail-job', {}, { attempts: 2 });

    const worker = new Worker(
      queueName,
      async () => {
        throw new Error('oops');
      },
      { connection, prefix },
    );
    await worker.waitUntilReady();

    await new Promise<void>(resolve => {
      worker.on('failed', job => {
        if (job && job.attemptsMade >= 2) {
          resolve();
        }
      });
    });
    await worker.close();

    const failedCount = await queue.getFailedCount();
    expect(failedCount).toBe(1);
    expect(await dlqQueue.getDeadLetterCount()).toBe(0);
  });

  // VAL-05: job still retrying does NOT land in DLQ
  it('does not route job to DLQ while retries remain', async () => {
    let attempts = 0;
    await queue.add(
      'retry-job',
      {},
      { attempts: 3, backoff: { type: 'fixed', delay: 10 } },
    );

    const worker = new Worker(
      queueName,
      async () => {
        attempts++;
        if (attempts < 3) {
          throw new Error('transient');
        }
      },
      { connection, prefix, deadLetterQueue: { queueName: dlqName } },
    );
    await worker.waitUntilReady();

    await new Promise<void>(resolve => {
      worker.on('completed', () => resolve());
    });
    await worker.close();

    expect(await dlqQueue.getDeadLetterCount()).toBe(0);
  });

  // VAL-07: DLQ job preserves original job name
  it('DLQ job preserves original job name', async () => {
    await queue.add('send-email', { to: 'a@b.com' }, { attempts: 1 });

    const worker = new Worker(
      queueName,
      async () => {
        throw new Error('fail');
      },
      { connection, prefix, deadLetterQueue: { queueName: dlqName } },
    );
    await worker.waitUntilReady();

    await new Promise<void>(resolve => {
      worker.on('failed', () => resolve());
    });
    await worker.close();

    const [dlqJob] = await dlqQueue.getDeadLetterJobs(0, 0);
    expect(dlqJob.name).toBe('send-email');
  });

  // VAL-08: deadLettered event emitted on source queue events stream
  it('emits deadLettered event when job is routed to DLQ', async () => {
    const queueEvents = new QueueEvents(queueName, { connection, prefix });
    await queueEvents.waitUntilReady();

    await queue.add('event-job', {}, { attempts: 1 });

    const worker = new Worker(
      queueName,
      async () => {
        throw new Error('fail');
      },
      { connection, prefix, deadLetterQueue: { queueName: dlqName } },
    );
    await worker.waitUntilReady();

    const event = await new Promise<any>(resolve => {
      (queueEvents as any).on('deadLettered', resolve);
    });

    await worker.close();
    await queueEvents.close();

    expect(event.jobId).toBeDefined();
    expect(event.deadLetterQueue).toBe(dlqName);
  });

  // VAL-09: getDeadLetterCount returns correct count
  it('getDeadLetterCount returns correct count', async () => {
    const count = 5;
    const promises: Promise<void>[] = [];

    const worker = new Worker(
      queueName,
      async () => {
        throw new Error('fail');
      },
      { connection, prefix, deadLetterQueue: { queueName: dlqName } },
    );
    await worker.waitUntilReady();

    let failedCount = 0;
    const done = new Promise<void>(resolve => {
      worker.on('failed', () => {
        failedCount++;
        if (failedCount === count) {
          resolve();
        }
      });
    });

    for (let i = 0; i < count; i++) {
      await queue.add('job', { i }, { attempts: 1 });
    }

    await done;
    await worker.close();

    expect(await dlqQueue.getDeadLetterCount()).toBe(count);
  });

  // VAL-10, VAL-11, VAL-12: getDeadLetterJobs pagination + peekDeadLetter
  it('getDeadLetterJobs returns paginated results', async () => {
    const total = 15;
    const worker = new Worker(
      queueName,
      async () => {
        throw new Error('fail');
      },
      { connection, prefix, deadLetterQueue: { queueName: dlqName } },
    );
    await worker.waitUntilReady();

    let failedCount = 0;
    const done = new Promise<void>(resolve => {
      worker.on('failed', () => {
        failedCount++;
        if (failedCount === total) {
          resolve();
        }
      });
    });

    for (let i = 0; i < total; i++) {
      await queue.add('job', { i }, { attempts: 1 });
    }

    await done;
    await worker.close();

    const firstPage = await dlqQueue.getDeadLetterJobs(0, 9);
    expect(firstPage).toHaveLength(10);

    const secondPage = await dlqQueue.getDeadLetterJobs(10, 14);
    expect(secondPage).toHaveLength(5);

    const firstJob = firstPage[0];
    const peeked = await dlqQueue.peekDeadLetter(firstJob.id!);
    expect(peeked).toBeDefined();
    expect(peeked?.data._dlqMeta).toBeDefined();
    expect(peeked?.data._dlqMeta.sourceQueue).toBe(queueName);

    expect(await dlqQueue.peekDeadLetter('nonexistent')).toBeUndefined();
  });

  // VAL-13, VAL-14, VAL-15: single replay
  it('replayDeadLetter re-enqueues job to source queue', async () => {
    await queue.add('order-job', { orderId: 42 }, { attempts: 1 });

    const worker = new Worker(
      queueName,
      async () => {
        throw new Error('fail');
      },
      { connection, prefix, deadLetterQueue: { queueName: dlqName } },
    );
    await worker.waitUntilReady();

    await new Promise<void>(resolve => {
      worker.on('failed', () => resolve());
    });
    await worker.close();

    const [dlqJob] = await dlqQueue.getDeadLetterJobs(0, 0);
    expect(dlqJob).toBeDefined();

    const newJobId = await dlqQueue.replayDeadLetter(dlqJob.id!);

    expect(typeof newJobId).toBe('string');
    expect(newJobId).not.toBe(dlqJob.id);

    const replayedJob = await queue.getJob(newJobId);
    expect(replayedJob).toBeDefined();
    expect(replayedJob?.data._dlqMeta).toBeUndefined();
    expect(replayedJob?.data.orderId).toBe(42);
    expect(replayedJob?.attemptsMade).toBe(0);

    expect(await dlqQueue.getDeadLetterCount()).toBe(0);

    await expect(dlqQueue.replayDeadLetter('nonexistent')).rejects.toThrow();
  });

  // VAL-16, VAL-21, VAL-22: bulk replay all jobs including multiple source queues
  it('replayAllDeadLetters replays all jobs including across multiple source queues', async () => {
    const queue2Name = `test-${v4()}`;
    const queue2 = new Queue(queue2Name, { connection, prefix });

    try {
      const worker1 = new Worker(
        queueName,
        async () => {
          throw new Error('fail');
        },
        { connection, prefix, deadLetterQueue: { queueName: dlqName } },
      );
      const worker2 = new Worker(
        queue2Name,
        async () => {
          throw new Error('fail');
        },
        { connection, prefix, deadLetterQueue: { queueName: dlqName } },
      );
      await worker1.waitUntilReady();
      await worker2.waitUntilReady();

      let failedCount = 0;
      const done = new Promise<void>(resolve => {
        const handler = () => {
          failedCount++;
          if (failedCount === 3) {
            resolve();
          }
        };
        worker1.on('failed', handler);
        worker2.on('failed', handler);
      });

      await queue.add('job', {}, { attempts: 1 });
      await queue.add('job', {}, { attempts: 1 });
      await queue2.add('job', {}, { attempts: 1 });

      await done;
      await worker1.close();
      await worker2.close();

      expect(await dlqQueue.getDeadLetterCount()).toBe(3);

      const replayed = await dlqQueue.replayAllDeadLetters();
      expect(replayed).toBe(3);
      expect(await dlqQueue.getDeadLetterCount()).toBe(0);

      expect(await queue.getWaitingCount()).toBeGreaterThanOrEqual(2);
      expect(await queue2.getWaitingCount()).toBeGreaterThanOrEqual(1);

      // empty DLQ returns 0
      expect(await dlqQueue.replayAllDeadLetters()).toBe(0);
    } finally {
      await queue2.close();
      await removeAllQueueData(new IORedis(redisHost), queue2Name);
    }
  });

  // VAL-17: filtered replay by name
  it('replayAllDeadLetters with name filter only replays matching jobs', async () => {
    const worker = new Worker(
      queueName,
      async () => {
        throw new Error('fail');
      },
      { connection, prefix, deadLetterQueue: { queueName: dlqName } },
    );
    await worker.waitUntilReady();

    let failedCount = 0;
    const done = new Promise<void>(resolve => {
      worker.on('failed', () => {
        failedCount++;
        if (failedCount === 3) {
          resolve();
        }
      });
    });

    await queue.add('send-email', {}, { attempts: 1 });
    await queue.add('send-email', {}, { attempts: 1 });
    await queue.add('charge-card', {}, { attempts: 1 });

    await done;
    await worker.close();

    const replayed = await dlqQueue.replayAllDeadLetters({
      name: 'send-email',
    });
    expect(replayed).toBe(2);
    expect(await dlqQueue.getDeadLetterCount()).toBe(1);

    const remaining = await dlqQueue.getDeadLetterJobs(0, 0);
    expect(remaining[0].name).toBe('charge-card');
  });

  // VAL-18: filtered replay by failedReason (case-insensitive substring)
  it('replayAllDeadLetters with failedReason filter uses case-insensitive substring match', async () => {
    let callCount = 0;
    const worker = new Worker(
      queueName,
      async () => {
        callCount++;
        if (callCount === 1) {
          throw new Error('ETIMEDOUT: connection timeout');
        }
        if (callCount === 2) {
          throw new Error('ECONNREFUSED: connection refused');
        }
        throw new Error('etimedout: lower case');
      },
      { connection, prefix, deadLetterQueue: { queueName: dlqName } },
    );
    await worker.waitUntilReady();

    let failedCount = 0;
    const done = new Promise<void>(resolve => {
      worker.on('failed', () => {
        failedCount++;
        if (failedCount === 3) {
          resolve();
        }
      });
    });

    await queue.add('job', {}, { attempts: 1 });
    await queue.add('job', {}, { attempts: 1 });
    await queue.add('job', {}, { attempts: 1 });

    await done;
    await worker.close();

    const replayed = await dlqQueue.replayAllDeadLetters({
      failedReason: 'ETIMEDOUT',
    });
    expect(replayed).toBe(2);
    expect(await dlqQueue.getDeadLetterCount()).toBe(1);
  });

  // VAL-19, VAL-22: purge all jobs
  it('purgeDeadLetters removes all jobs and returns count', async () => {
    const worker = new Worker(
      queueName,
      async () => {
        throw new Error('fail');
      },
      { connection, prefix, deadLetterQueue: { queueName: dlqName } },
    );
    await worker.waitUntilReady();

    let failedCount = 0;
    const done = new Promise<void>(resolve => {
      worker.on('failed', () => {
        failedCount++;
        if (failedCount === 5) {
          resolve();
        }
      });
    });

    for (let i = 0; i < 5; i++) {
      await queue.add('job', { i }, { attempts: 1 });
    }

    await done;
    await worker.close();

    expect(await dlqQueue.purgeDeadLetters()).toBe(5);
    expect(await dlqQueue.getDeadLetterCount()).toBe(0);

    // empty DLQ returns 0
    expect(await dlqQueue.purgeDeadLetters()).toBe(0);
  });

  // VAL-20: purge filtered by name
  it('purgeDeadLetters with name filter only removes matching jobs', async () => {
    const worker = new Worker(
      queueName,
      async () => {
        throw new Error('fail');
      },
      { connection, prefix, deadLetterQueue: { queueName: dlqName } },
    );
    await worker.waitUntilReady();

    let failedCount = 0;
    const done = new Promise<void>(resolve => {
      worker.on('failed', () => {
        failedCount++;
        if (failedCount === 3) {
          resolve();
        }
      });
    });

    await queue.add('send-email', {}, { attempts: 1 });
    await queue.add('send-email', {}, { attempts: 1 });
    await queue.add('charge-card', {}, { attempts: 1 });

    await done;
    await worker.close();

    expect(await dlqQueue.purgeDeadLetters({ name: 'send-email' })).toBe(2);
    expect(await dlqQueue.getDeadLetterCount()).toBe(1);

    const remaining = await dlqQueue.getDeadLetterJobs(0, 0);
    expect(remaining[0].name).toBe('charge-card');
  });
});
