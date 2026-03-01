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
import { removeAllQueueData, delay } from '../src/utils';

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

  // Worker construction validation
  it('throws when deadLetterQueue.queueName is empty', () => {
    expect(
      () =>
        new Worker(queueName, async () => {}, {
          connection,
          prefix,
          deadLetterQueue: { queueName: '' },
        }),
    ).toThrow('deadLetterQueue.queueName must be a non-empty string');
  });

  // VAL-01: No DLQ configured — existing failed-set behavior unchanged
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
      worker.on('failed', (_job, _err, prev) => {
        if (prev === 'active' && _job!.attemptsMade >= 2) {
          resolve();
        }
      });
    });

    await worker.close();

    const failedCount = await queue.getFailedCount();
    expect(failedCount).toBe(1);
    expect(await dlqQueue.getDeadLetterCount()).toBe(0);
  });

  // VAL-02, VAL-06: Job routed to DLQ after exhausting retries + full metadata
  it('routes job to DLQ after exhausting retries with full _dlqMeta', async () => {
    await queue.add(
      'test-job',
      { orderId: 123 },
      {
        attempts: 3,
        backoff: { type: 'fixed', delay: 10 },
      },
    );

    const worker = new Worker(
      queueName,
      async () => {
        throw new Error('Connection refused');
      },
      {
        connection,
        prefix,
        deadLetterQueue: { queueName: dlqName },
      },
    );
    await worker.waitUntilReady();

    await new Promise<void>(resolve => {
      worker.on('failed', (_job, _err, prev) => {
        if (prev === 'active' && _job!.attemptsMade >= 3) {
          resolve();
        }
      });
    });

    await worker.close();

    const count = await dlqQueue.getDeadLetterCount();
    expect(count).toBe(1);

    const jobs = await dlqQueue.getDeadLetterJobs(0, 0);
    expect(jobs).toHaveLength(1);
    const dlqJob = jobs[0];

    expect(dlqJob.data.orderId).toBe(123);
    expect(dlqJob.name).toBe('test-job');

    const meta = (dlqJob.data as any)._dlqMeta;
    expect(meta).toBeDefined();
    expect(meta.sourceQueue).toBe(queueName);
    expect(meta.failedReason).toBe('Connection refused');
    expect(meta.attemptsMade).toBe(3);
    expect(Array.isArray(meta.stacktrace)).toBe(true);
    expect(meta.stacktrace).toHaveLength(3);
    expect(typeof meta.deadLetteredAt).toBe('number');
    expect(meta.deadLetteredAt).toBeGreaterThan(0);
    expect(meta.originalOpts.attempts).toBe(3);

    const failedCount = await queue.getFailedCount();
    expect(failedCount).toBe(0);
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

    const jobs = await dlqQueue.getDeadLetterJobs(0, 0);
    const dlqJob = jobs[0];
    expect((dlqJob.data as any)._dlqMeta.attemptsMade).toBe(1);
    expect((dlqJob.data as any)._dlqMeta.failedReason).toBe('Invalid payload');
  });

  // VAL-04: Successful job does NOT go to DLQ
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

  // VAL-05: Retried job does not go to DLQ until retries exhausted
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

    const jobs = await dlqQueue.getDeadLetterJobs(0, 0);
    expect(jobs[0].name).toBe('send-email');
  });

  // VAL-08: deadLettered event emitted on source queue
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

    const deadLetteredEvent = await new Promise<any>(resolve => {
      (queueEvents as any).on('deadLettered', resolve);
    });

    await worker.close();
    await queueEvents.close();

    expect(deadLetteredEvent.jobId).toBeDefined();
    expect(deadLetteredEvent.deadLetterQueue).toBe(dlqName);
  });

  // VAL-09: getDeadLetterCount returns correct count
  it('getDeadLetterCount returns correct count', async () => {
    const jobCount = 5;
    for (let i = 0; i < jobCount; i++) {
      await queue.add('count-job', { i }, { attempts: 1 });
    }

    const worker = new Worker(
      queueName,
      async () => {
        throw new Error('fail');
      },
      { connection, prefix, deadLetterQueue: { queueName: dlqName } },
    );
    await worker.waitUntilReady();

    let failCount = 0;
    await new Promise<void>(resolve => {
      worker.on('failed', () => {
        failCount++;
        if (failCount >= jobCount) {resolve();}
      });
    });

    await worker.close();
    expect(await dlqQueue.getDeadLetterCount()).toBe(jobCount);
  });

  // VAL-10: getDeadLetterJobs returns paginated results
  it('getDeadLetterJobs returns paginated results', async () => {
    const jobCount = 15;
    for (let i = 0; i < jobCount; i++) {
      await queue.add('page-job', { i }, { attempts: 1 });
    }

    const worker = new Worker(
      queueName,
      async () => {
        throw new Error('fail');
      },
      { connection, prefix, deadLetterQueue: { queueName: dlqName } },
    );
    await worker.waitUntilReady();

    let failCount = 0;
    await new Promise<void>(resolve => {
      worker.on('failed', () => {
        failCount++;
        if (failCount >= jobCount) {resolve();}
      });
    });

    await worker.close();

    const page1 = await dlqQueue.getDeadLetterJobs(0, 9);
    expect(page1).toHaveLength(10);

    const page2 = await dlqQueue.getDeadLetterJobs(10, 14);
    expect(page2).toHaveLength(5);
  });

  // VAL-11, VAL-12: peekDeadLetter returns job with metadata, undefined for missing
  it('peekDeadLetter returns job with _dlqMeta and undefined for non-existent job', async () => {
    await queue.add('peek-job', { x: 1 }, { attempts: 1 });

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

    const jobs = await dlqQueue.getDeadLetterJobs(0, 0);
    const peeked = await dlqQueue.peekDeadLetter(jobs[0].id!);
    expect(peeked).toBeDefined();
    expect((peeked!.data as any)._dlqMeta).toBeDefined();
    expect((peeked!.data as any)._dlqMeta.sourceQueue).toBe(queueName);

    const missing = await dlqQueue.peekDeadLetter('nonexistent-id');
    expect(missing).toBeUndefined();
  });

  // VAL-13, VAL-14, VAL-15: replayDeadLetter
  it('replayDeadLetter re-enqueues job to source queue with reset attempts', async () => {
    await queue.add('replay-job', { val: 42 }, { attempts: 1 });

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

    const dlqJobs = await dlqQueue.getDeadLetterJobs(0, 0);
    expect(dlqJobs).toHaveLength(1);
    const dlqJob = dlqJobs[0];

    const newJobId = await dlqQueue.replayDeadLetter(dlqJob.id!);

    expect(typeof newJobId).toBe('string');
    expect(newJobId).not.toBe(dlqJob.id);

    const replayedJob = await queue.getJob(newJobId);
    expect(replayedJob).toBeDefined();
    expect(replayedJob!.data.val).toBe(42);
    expect((replayedJob!.data as any)._dlqMeta).toBeUndefined();
    expect(replayedJob!.attemptsMade).toBe(0);

    expect(await dlqQueue.getDeadLetterCount()).toBe(0);

    await expect(dlqQueue.replayDeadLetter('nonexistent-id')).rejects.toThrow();
  });

  // VAL-16, VAL-21, VAL-22: replayAllDeadLetters replays all jobs
  it('replayAllDeadLetters replays all jobs and returns count', async () => {
    for (let i = 0; i < 3; i++) {
      await queue.add('bulk-replay', { i }, { attempts: 1 });
    }

    const worker = new Worker(
      queueName,
      async () => {
        throw new Error('fail');
      },
      { connection, prefix, deadLetterQueue: { queueName: dlqName } },
    );
    await worker.waitUntilReady();

    let failCount = 0;
    await new Promise<void>(resolve => {
      worker.on('failed', () => {
        failCount++;
        if (failCount >= 3) {resolve();}
      });
    });
    await worker.close();

    expect(await dlqQueue.getDeadLetterCount()).toBe(3);

    const replayed = await dlqQueue.replayAllDeadLetters();
    expect(replayed).toBe(3);
    expect(await dlqQueue.getDeadLetterCount()).toBe(0);

    const waitingInSource = await queue.getWaitingCount();
    expect(waitingInSource).toBe(3);

    expect(await dlqQueue.replayAllDeadLetters()).toBe(0);
  });

  // VAL-17: replayAllDeadLetters with name filter
  it('replayAllDeadLetters with name filter only replays matching jobs', async () => {
    await queue.add('send-email', {}, { attempts: 1 });
    await queue.add('send-email', {}, { attempts: 1 });
    await queue.add('charge-card', {}, { attempts: 1 });

    const worker = new Worker(
      queueName,
      async () => {
        throw new Error('fail');
      },
      { connection, prefix, deadLetterQueue: { queueName: dlqName } },
    );
    await worker.waitUntilReady();

    let failCount = 0;
    await new Promise<void>(resolve => {
      worker.on('failed', () => {
        failCount++;
        if (failCount >= 3) {resolve();}
      });
    });
    await worker.close();

    const replayed = await dlqQueue.replayAllDeadLetters({
      name: 'send-email',
    });
    expect(replayed).toBe(2);
    expect(await dlqQueue.getDeadLetterCount()).toBe(1);

    const remaining = await dlqQueue.getDeadLetterJobs(0, 0);
    expect(remaining[0].name).toBe('charge-card');
  });

  // VAL-18: replayAllDeadLetters with failedReason filter (case-insensitive substring)
  it('replayAllDeadLetters with failedReason filter uses case-insensitive substring match', async () => {
    await queue.add('job-a', {}, { attempts: 1 });
    await queue.add('job-b', {}, { attempts: 1 });
    await queue.add('job-c', {}, { attempts: 1 });

    let callCount = 0;
    const errors = ['ETIMEDOUT', 'ECONNREFUSED', 'etimedout'];

    const worker = new Worker(
      queueName,
      async () => {
        throw new Error(errors[callCount++] || 'unknown');
      },
      { connection, prefix, deadLetterQueue: { queueName: dlqName } },
    );
    await worker.waitUntilReady();

    let failCount = 0;
    await new Promise<void>(resolve => {
      worker.on('failed', () => {
        failCount++;
        if (failCount >= 3) {resolve();}
      });
    });
    await worker.close();

    const replayed = await dlqQueue.replayAllDeadLetters({
      failedReason: 'ETIMEDOUT',
    });
    expect(replayed).toBe(2);
    expect(await dlqQueue.getDeadLetterCount()).toBe(1);

    const remaining = await dlqQueue.getDeadLetterJobs(0, 0);
    expect((remaining[0].data as any)._dlqMeta.failedReason).toBe(
      'ECONNREFUSED',
    );
  });

  // VAL-19, VAL-22: purgeDeadLetters removes all
  it('purgeDeadLetters removes all jobs and returns count', async () => {
    for (let i = 0; i < 5; i++) {
      await queue.add('purge-job', { i }, { attempts: 1 });
    }

    const worker = new Worker(
      queueName,
      async () => {
        throw new Error('fail');
      },
      { connection, prefix, deadLetterQueue: { queueName: dlqName } },
    );
    await worker.waitUntilReady();

    let failCount = 0;
    await new Promise<void>(resolve => {
      worker.on('failed', () => {
        failCount++;
        if (failCount >= 5) {resolve();}
      });
    });
    await worker.close();

    expect(await dlqQueue.purgeDeadLetters()).toBe(5);
    expect(await dlqQueue.getDeadLetterCount()).toBe(0);
    expect(await dlqQueue.purgeDeadLetters()).toBe(0);
  });

  // VAL-20: purgeDeadLetters with name filter
  it('purgeDeadLetters with name filter only removes matching jobs', async () => {
    await queue.add('send-email', {}, { attempts: 1 });
    await queue.add('send-email', {}, { attempts: 1 });
    await queue.add('charge-card', {}, { attempts: 1 });

    const worker = new Worker(
      queueName,
      async () => {
        throw new Error('fail');
      },
      { connection, prefix, deadLetterQueue: { queueName: dlqName } },
    );
    await worker.waitUntilReady();

    let failCount = 0;
    await new Promise<void>(resolve => {
      worker.on('failed', () => {
        failCount++;
        if (failCount >= 3) {resolve();}
      });
    });
    await worker.close();

    expect(await dlqQueue.purgeDeadLetters({ name: 'send-email' })).toBe(2);
    expect(await dlqQueue.getDeadLetterCount()).toBe(1);

    const remaining = await dlqQueue.getDeadLetterJobs(0, 0);
    expect(remaining[0].name).toBe('charge-card');
  });

  // VAL-21: Bulk replay handles multiple source queues
  it('replayAllDeadLetters handles jobs from multiple source queues', async () => {
    const secondQueueName = `test-${v4()}`;
    const secondQueue = new Queue(secondQueueName, { connection, prefix });

    try {
      await queue.add('from-source-1', { src: 1 }, { attempts: 1 });
      await queue.add('from-source-1', { src: 1 }, { attempts: 1 });
      await secondQueue.add('from-source-2', { src: 2 }, { attempts: 1 });

      const worker1 = new Worker(
        queueName,
        async () => {
          throw new Error('fail');
        },
        { connection, prefix, deadLetterQueue: { queueName: dlqName } },
      );
      const worker2 = new Worker(
        secondQueueName,
        async () => {
          throw new Error('fail');
        },
        { connection, prefix, deadLetterQueue: { queueName: dlqName } },
      );

      await worker1.waitUntilReady();
      await worker2.waitUntilReady();

      let failCount = 0;
      await new Promise<void>(resolve => {
        const onFailed = () => {
          failCount++;
          if (failCount >= 3) {resolve();}
        };
        worker1.on('failed', onFailed);
        worker2.on('failed', onFailed);
      });

      await worker1.close();
      await worker2.close();

      expect(await dlqQueue.getDeadLetterCount()).toBe(3);

      const replayed = await dlqQueue.replayAllDeadLetters();
      expect(replayed).toBe(3);
      expect(await dlqQueue.getDeadLetterCount()).toBe(0);

      expect(await queue.getWaitingCount()).toBe(2);
      expect(await secondQueue.getWaitingCount()).toBe(1);
    } finally {
      await secondQueue.close();
      await removeAllQueueData(new IORedis(redisHost), secondQueueName);
    }
  });
});
