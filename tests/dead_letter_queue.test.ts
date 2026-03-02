import { Queue, Worker, QueueEvents } from '../src/classes';
import { UnrecoverableError } from '../src/classes/errors';
import { delay, removeAllQueueData } from '../src/utils';
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
import { DeadLetterMetadata } from '../src/interfaces';

describe('dead letter queue', () => {
  const redisHost = process.env.REDIS_HOST || 'localhost';
  const prefix = process.env.BULLMQ_TEST_PREFIX || 'bull';

  let queue: Queue;
  let dlqQueue: Queue;
  let queueName: string;
  let dlqQueueName: string;
  let connection: IORedis;

  beforeAll(async () => {
    connection = new IORedis(redisHost, { maxRetriesPerRequest: null });
  });

  beforeEach(async () => {
    queueName = `test-${v4()}`;
    dlqQueueName = `${queueName}-dlq`;
    queue = new Queue(queueName, { connection, prefix });
    dlqQueue = new Queue(dlqQueueName, { connection, prefix });
  });

  afterEach(async () => {
    await queue.close();
    await dlqQueue.close();
    await removeAllQueueData(new IORedis(redisHost), queueName);
    await removeAllQueueData(new IORedis(redisHost), dlqQueueName);
  });

  afterAll(async () => {
    await connection.quit();
  });

  // VAL-01: DLQ not configured, failure behavior unchanged
  it('VAL-01: routes job to failed set when deadLetterQueue not configured', async () => {
    const worker = new Worker(
      queueName,
      async () => {
        throw new Error('always fails');
      },
      { connection, prefix, attempts: 2 },
    );

    await queue.add('test-job', { x: 1 }, { attempts: 2 });

    await new Promise<void>(resolve => {
      worker.on('failed', async (_job, _err, _prev) => {
        const failedCount = await queue.getFailedCount();
        if (failedCount > 0) {
          resolve();
        }
      });
    });

    const failedJobs = await queue.getFailed(0, 10);
    expect(failedJobs.length).toBeGreaterThan(0);

    const dlqCount = await dlqQueue.getDeadLetterCount();
    expect(dlqCount).toBe(0);

    await worker.close();
  });

  // VAL-02: Job routed to DLQ after exhausting retries
  it('VAL-02: routes job to DLQ after exhausting retries', async () => {
    const worker = new Worker(
      queueName,
      async () => {
        throw new Error('always fails');
      },
      {
        connection,
        prefix,
        deadLetterQueue: { queueName: dlqQueueName },
      },
    );

    await queue.add('test-job', { orderId: 42 }, { attempts: 3 });

    await new Promise<void>(resolve => {
      queue.on('deadLettered', () => resolve());
    });

    const failedJobs = await queue.getFailed(0, 10);
    expect(failedJobs.length).toBe(0);

    const dlqCount = await dlqQueue.getDeadLetterCount();
    expect(dlqCount).toBe(1);

    const dlqJobs = await dlqQueue.getDeadLetterJobs(0, 10);
    expect(dlqJobs.length).toBe(1);
    const meta: DeadLetterMetadata = (dlqJobs[0].data as any)._dlqMeta;
    expect(meta.sourceQueue).toBe(queueName);
    expect(meta.failedReason).toBe('always fails');
    expect(meta.attemptsMade).toBe(3);

    await worker.close();
  });

  // VAL-03: UnrecoverableError goes directly to DLQ
  it('VAL-03: UnrecoverableError goes directly to DLQ after 1 attempt', async () => {
    const worker = new Worker(
      queueName,
      async () => {
        throw new UnrecoverableError('unrecoverable');
      },
      {
        connection,
        prefix,
        deadLetterQueue: { queueName: dlqQueueName },
      },
    );

    await queue.add('test-job', { x: 1 }, { attempts: 5 });

    await new Promise<void>(resolve => {
      queue.on('deadLettered', () => resolve());
    });

    const dlqJobs = await dlqQueue.getDeadLetterJobs(0, 10);
    expect(dlqJobs.length).toBe(1);
    const meta: DeadLetterMetadata = (dlqJobs[0].data as any)._dlqMeta;
    expect(meta.attemptsMade).toBe(1);

    await worker.close();
  });

  // VAL-04: Successful job does not go to DLQ
  it('VAL-04: successful job does not go to DLQ', async () => {
    let attempts = 0;
    const worker = new Worker(
      queueName,
      async () => {
        attempts++;
        if (attempts < 3) {
          throw new Error('retry me');
        }
      },
      {
        connection,
        prefix,
        deadLetterQueue: { queueName: dlqQueueName },
      },
    );

    await queue.add('test-job', { x: 1 }, { attempts: 3 });

    await new Promise<void>(resolve => {
      worker.on('completed', () => resolve());
    });

    const completedJobs = await queue.getCompleted(0, 10);
    expect(completedJobs.length).toBe(1);

    const dlqCount = await dlqQueue.getDeadLetterCount();
    expect(dlqCount).toBe(0);

    await worker.close();
  });

  // VAL-05: Retried job does not go to DLQ until retries exhausted
  it('VAL-05: retried job stays in retry path until retries exhausted', async () => {
    const worker = new Worker(
      queueName,
      async () => {
        throw new Error('always fails');
      },
      {
        connection,
        prefix,
        deadLetterQueue: { queueName: dlqQueueName },
      },
    );

    await queue.add(
      'test-job',
      { x: 1 },
      { attempts: 3, backoff: { type: 'fixed', delay: 100 } },
    );

    // After first failure, should be in delayed (not DLQ)
    await new Promise<void>(resolve => worker.on('failed', resolve as any));
    const dlqCountMid = await dlqQueue.getDeadLetterCount();
    expect(dlqCountMid).toBe(0);

    // Wait for all retries to exhaust
    await new Promise<void>(resolve => {
      queue.on('deadLettered', () => resolve());
    });

    const dlqCount = await dlqQueue.getDeadLetterCount();
    expect(dlqCount).toBe(1);

    await worker.close();
  });

  // VAL-06: DLQ metadata is complete
  it('VAL-06: DLQ job contains complete _dlqMeta', async () => {
    const worker = new Worker(
      queueName,
      async () => {
        throw new Error('Connection refused');
      },
      {
        connection,
        prefix,
        deadLetterQueue: { queueName: dlqQueueName },
      },
    );

    const before = Date.now();
    await queue.add(
      'test-job',
      { orderId: 123 },
      {
        attempts: 2,
        backoff: { type: 'fixed', delay: 100 },
      },
    );

    await new Promise<void>(resolve => {
      queue.on('deadLettered', () => resolve());
    });

    const dlqJobs = await dlqQueue.getDeadLetterJobs(0, 10);
    expect(dlqJobs.length).toBe(1);

    const dlqJob = dlqJobs[0];
    expect((dlqJob.data as any).orderId).toBe(123);
    expect((dlqJob.data as any)._dlqMeta).toBeDefined();

    const meta: DeadLetterMetadata = (dlqJob.data as any)._dlqMeta;
    expect(meta.sourceQueue).toBe(queueName);
    expect(meta.failedReason).toBe('Connection refused');
    expect(Array.isArray(meta.stacktrace)).toBe(true);
    expect(meta.stacktrace.length).toBeGreaterThanOrEqual(1);
    expect(meta.attemptsMade).toBe(2);
    expect(meta.deadLetteredAt).toBeGreaterThanOrEqual(before);
    expect(meta.originalOpts.attempts).toBe(2);

    await worker.close();
  });

  // VAL-07: DLQ job preserves original job name
  it('VAL-07: DLQ job preserves original job name', async () => {
    const worker = new Worker(
      queueName,
      async () => {
        throw new Error('fail');
      },
      {
        connection,
        prefix,
        deadLetterQueue: { queueName: dlqQueueName },
      },
    );

    await queue.add('send-email', { to: 'user@example.com' }, { attempts: 1 });

    await new Promise<void>(resolve => {
      queue.on('deadLettered', () => resolve());
    });

    const dlqJobs = await dlqQueue.getDeadLetterJobs(0, 10);
    expect(dlqJobs.length).toBe(1);
    expect(dlqJobs[0].name).toBe('send-email');

    await worker.close();
  });

  // VAL-08: deadLettered event emitted
  it('VAL-08: deadLettered event is emitted on source queue events', async () => {
    const queueEvents = new QueueEvents(queueName, { connection, prefix });

    const worker = new Worker(
      queueName,
      async () => {
        throw new Error('terminal');
      },
      {
        connection,
        prefix,
        deadLetterQueue: { queueName: dlqQueueName },
      },
    );

    const job = await queue.add('test-job', {}, { attempts: 1 });

    const eventData = await new Promise<any>(resolve => {
      queueEvents.on('deadLettered' as any, (data: any) => resolve(data));
    });

    expect(eventData.jobId).toBe(job.id);
    expect(eventData.deadLetterQueue).toBe(dlqQueueName);

    await queueEvents.close();
    await worker.close();
  });

  // VAL-09: getDeadLetterCount returns correct count
  it('VAL-09: getDeadLetterCount returns correct count', async () => {
    const worker = new Worker(
      queueName,
      async () => {
        throw new Error('fail');
      },
      {
        connection,
        prefix,
        deadLetterQueue: { queueName: dlqQueueName },
      },
    );

    const jobs = Array.from({ length: 5 }, (_, i) =>
      queue.add('job', { i }, { attempts: 1 }),
    );
    await Promise.all(jobs);

    await new Promise<void>(resolve => {
      let count = 0;
      queue.on('deadLettered', () => {
        count++;
        if (count === 5) {
          resolve();
        }
      });
    });

    const dlqCount = await dlqQueue.getDeadLetterCount();
    expect(dlqCount).toBe(5);

    await worker.close();
  });

  // VAL-10: getDeadLetterJobs returns paginated results
  it('VAL-10: getDeadLetterJobs returns paginated results', async () => {
    const worker = new Worker(
      queueName,
      async () => {
        throw new Error('fail');
      },
      {
        connection,
        prefix,
        deadLetterQueue: { queueName: dlqQueueName },
      },
    );

    const jobPromises = Array.from({ length: 15 }, (_, i) =>
      queue.add('job', { i }, { attempts: 1 }),
    );
    await Promise.all(jobPromises);

    await new Promise<void>(resolve => {
      let count = 0;
      queue.on('deadLettered', () => {
        count++;
        if (count === 15) {
          resolve();
        }
      });
    });

    const firstPage = await dlqQueue.getDeadLetterJobs(0, 9);
    expect(firstPage.length).toBe(10);

    const secondPage = await dlqQueue.getDeadLetterJobs(10, 14);
    expect(secondPage.length).toBe(5);

    await worker.close();
  });

  // VAL-11: peekDeadLetter returns job with metadata
  it('VAL-11: peekDeadLetter returns job with _dlqMeta', async () => {
    const worker = new Worker(
      queueName,
      async () => {
        throw new Error('fail');
      },
      {
        connection,
        prefix,
        deadLetterQueue: { queueName: dlqQueueName },
      },
    );

    await queue.add('test-job', { x: 99 }, { attempts: 1 });

    await new Promise<void>(resolve => {
      queue.on('deadLettered', () => resolve());
    });

    const dlqJobs = await dlqQueue.getDeadLetterJobs(0, 0);
    expect(dlqJobs.length).toBe(1);
    const dlqJobId = dlqJobs[0].id;

    const peeked = await dlqQueue.peekDeadLetter(dlqJobId);
    expect(peeked).toBeDefined();
    expect((peeked!.data as any)._dlqMeta).toBeDefined();
    expect((peeked!.data as any)._dlqMeta.sourceQueue).toBe(queueName);

    await worker.close();
  });

  // VAL-12: peekDeadLetter returns undefined for missing job
  it('VAL-12: peekDeadLetter returns undefined for nonexistent job', async () => {
    const result = await dlqQueue.peekDeadLetter('nonexistent-id');
    expect(result).toBeUndefined();
  });

  // VAL-13: replayDeadLetter re-enqueues to source queue
  it('VAL-13: replayDeadLetter re-enqueues job to source queue', async () => {
    const worker = new Worker(
      queueName,
      async () => {
        throw new Error('fail');
      },
      {
        connection,
        prefix,
        deadLetterQueue: { queueName: dlqQueueName },
      },
    );

    const original = await queue.add(
      'test-job',
      { orderId: 77 },
      { attempts: 1 },
    );

    await new Promise<void>(resolve => {
      queue.on('deadLettered', () => resolve());
    });
    await worker.close();

    const dlqJobs = await dlqQueue.getDeadLetterJobs(0, 0);
    expect(dlqJobs.length).toBe(1);
    const dlqJobId = dlqJobs[0].id;

    const newJobId = await dlqQueue.replayDeadLetter(dlqJobId);
    expect(typeof newJobId).toBe('string');

    // DLQ should be empty now
    const dlqCount = await dlqQueue.getDeadLetterCount();
    expect(dlqCount).toBe(0);

    // Source queue should have the new job in waiting
    const waitingJobs = await queue.getWaiting(0, 10);
    const replayed = waitingJobs.find(j => j.id === newJobId);
    expect(replayed).toBeDefined();
    expect((replayed!.data as any).orderId).toBe(77);
    expect((replayed!.data as any)._dlqMeta).toBeUndefined();
    expect(replayed!.attemptsMade).toBe(0);
    expect(replayed!.id).not.toBe(original.id);
  });

  // VAL-14: replayDeadLetter returns new job ID
  it('VAL-14: replayDeadLetter returns a new job ID different from original', async () => {
    const worker = new Worker(
      queueName,
      async () => {
        throw new Error('fail');
      },
      {
        connection,
        prefix,
        deadLetterQueue: { queueName: dlqQueueName },
      },
    );

    const original = await queue.add('test-job', {}, { attempts: 1 });

    await new Promise<void>(resolve => {
      queue.on('deadLettered', () => resolve());
    });
    await worker.close();

    const dlqJobs = await dlqQueue.getDeadLetterJobs(0, 0);
    const dlqJobId = dlqJobs[0].id;
    const newJobId = await dlqQueue.replayDeadLetter(dlqJobId);

    expect(typeof newJobId).toBe('string');
    expect(newJobId).not.toBe(original.id);
    expect(newJobId).not.toBe(dlqJobId);
  });

  // VAL-15: replayDeadLetter throws for non-existent job
  it('VAL-15: replayDeadLetter throws for nonexistent job', async () => {
    await expect(dlqQueue.replayDeadLetter('nonexistent-id')).rejects.toThrow();
  });

  // VAL-16: replayAllDeadLetters replays all jobs
  it('VAL-16: replayAllDeadLetters replays all jobs and returns count', async () => {
    const worker = new Worker(
      queueName,
      async () => {
        throw new Error('fail');
      },
      {
        connection,
        prefix,
        deadLetterQueue: { queueName: dlqQueueName },
      },
    );

    const jobPromises = Array.from({ length: 3 }, () =>
      queue.add('job', {}, { attempts: 1 }),
    );
    await Promise.all(jobPromises);

    await new Promise<void>(resolve => {
      let count = 0;
      queue.on('deadLettered', () => {
        count++;
        if (count === 3) {
          resolve();
        }
      });
    });
    await worker.close();

    const replayed = await dlqQueue.replayAllDeadLetters();
    expect(replayed).toBe(3);

    const dlqCount = await dlqQueue.getDeadLetterCount();
    expect(dlqCount).toBe(0);

    const waitingCount = await queue.getWaitingCount();
    expect(waitingCount).toBe(3);
  });

  // VAL-17: replayAllDeadLetters with name filter
  it('VAL-17: replayAllDeadLetters with name filter only replays matching jobs', async () => {
    const worker = new Worker(
      queueName,
      async () => {
        throw new Error('fail');
      },
      {
        connection,
        prefix,
        deadLetterQueue: { queueName: dlqQueueName },
      },
    );

    await queue.add('send-email', {}, { attempts: 1 });
    await queue.add('send-email', {}, { attempts: 1 });
    await queue.add('charge-card', {}, { attempts: 1 });

    await new Promise<void>(resolve => {
      let count = 0;
      queue.on('deadLettered', () => {
        count++;
        if (count === 3) {
          resolve();
        }
      });
    });
    await worker.close();

    const replayed = await dlqQueue.replayAllDeadLetters({
      name: 'send-email',
    });
    expect(replayed).toBe(2);

    const dlqCount = await dlqQueue.getDeadLetterCount();
    expect(dlqCount).toBe(1);

    const remaining = await dlqQueue.getDeadLetterJobs(0, 10);
    expect(remaining[0].name).toBe('charge-card');
  });

  // VAL-18: replayAllDeadLetters with failedReason filter
  it('VAL-18: replayAllDeadLetters with failedReason filter only replays matching jobs', async () => {
    let callCount = 0;
    const worker = new Worker(
      queueName,
      async () => {
        callCount++;
        const reasons = ['ETIMEDOUT', 'ECONNREFUSED', 'ETIMEDOUT'];
        throw new Error(reasons[(callCount - 1) % reasons.length]);
      },
      {
        connection,
        prefix,
        deadLetterQueue: { queueName: dlqQueueName },
      },
    );

    await queue.add('job1', {}, { attempts: 1 });
    await queue.add('job2', {}, { attempts: 1 });
    await queue.add('job3', {}, { attempts: 1 });

    await new Promise<void>(resolve => {
      let count = 0;
      queue.on('deadLettered', () => {
        count++;
        if (count === 3) {
          resolve();
        }
      });
    });
    await worker.close();

    const replayed = await dlqQueue.replayAllDeadLetters({
      failedReason: 'ETIMEDOUT',
    });
    expect(replayed).toBe(2);

    const dlqCount = await dlqQueue.getDeadLetterCount();
    expect(dlqCount).toBe(1);
  });

  // VAL-19: purgeDeadLetters removes all
  it('VAL-19: purgeDeadLetters removes all jobs and returns count', async () => {
    const worker = new Worker(
      queueName,
      async () => {
        throw new Error('fail');
      },
      {
        connection,
        prefix,
        deadLetterQueue: { queueName: dlqQueueName },
      },
    );

    const jobPromises = Array.from({ length: 5 }, () =>
      queue.add('job', {}, { attempts: 1 }),
    );
    await Promise.all(jobPromises);

    await new Promise<void>(resolve => {
      let count = 0;
      queue.on('deadLettered', () => {
        count++;
        if (count === 5) {
          resolve();
        }
      });
    });
    await worker.close();

    const removed = await dlqQueue.purgeDeadLetters();
    expect(removed).toBe(5);

    const dlqCount = await dlqQueue.getDeadLetterCount();
    expect(dlqCount).toBe(0);
  });

  // VAL-20: purgeDeadLetters with filter
  it('VAL-20: purgeDeadLetters with name filter only removes matching jobs', async () => {
    const worker = new Worker(
      queueName,
      async () => {
        throw new Error('fail');
      },
      {
        connection,
        prefix,
        deadLetterQueue: { queueName: dlqQueueName },
      },
    );

    await queue.add('send-email', {}, { attempts: 1 });
    await queue.add('send-email', {}, { attempts: 1 });
    await queue.add('charge-card', {}, { attempts: 1 });

    await new Promise<void>(resolve => {
      let count = 0;
      queue.on('deadLettered', () => {
        count++;
        if (count === 3) {
          resolve();
        }
      });
    });
    await worker.close();

    const removed = await dlqQueue.purgeDeadLetters({ name: 'send-email' });
    expect(removed).toBe(2);

    const dlqCount = await dlqQueue.getDeadLetterCount();
    expect(dlqCount).toBe(1);

    const remaining = await dlqQueue.getDeadLetterJobs(0, 10);
    expect(remaining[0].name).toBe('charge-card');
  });

  // VAL-21: Bulk replay handles multiple source queues
  it('VAL-21: replayAllDeadLetters handles jobs from multiple source queues', async () => {
    const queue2Name = `test-${v4()}`;
    const queue2 = new Queue(queue2Name, { connection, prefix });

    const worker1 = new Worker(
      queueName,
      async () => {
        throw new Error('fail');
      },
      {
        connection,
        prefix,
        deadLetterQueue: { queueName: dlqQueueName },
      },
    );

    const worker2 = new Worker(
      queue2Name,
      async () => {
        throw new Error('fail');
      },
      {
        connection,
        prefix,
        deadLetterQueue: { queueName: dlqQueueName },
      },
    );

    await queue.add('job', {}, { attempts: 1 });
    await queue.add('job', {}, { attempts: 1 });
    await queue2.add('job', {}, { attempts: 1 });

    const q1Events = new Queue(queueName, { connection, prefix });
    const q2Events = new Queue(queue2Name, { connection, prefix });
    let deadLetteredCount = 0;
    await new Promise<void>(resolve => {
      const handler = () => {
        deadLetteredCount++;
        if (deadLetteredCount === 3) {
          resolve();
        }
      };
      q1Events.on('deadLettered', handler);
      q2Events.on('deadLettered', handler);
    });

    await worker1.close();
    await worker2.close();

    const replayed = await dlqQueue.replayAllDeadLetters();
    expect(replayed).toBe(3);

    const dlqCount = await dlqQueue.getDeadLetterCount();
    expect(dlqCount).toBe(0);

    const q1Waiting = await queue.getWaitingCount();
    const q2Waiting = await queue2.getWaitingCount();
    expect(q1Waiting).toBe(2);
    expect(q2Waiting).toBe(1);

    await queue2.close();
    await q1Events.close();
    await q2Events.close();
    await removeAllQueueData(new IORedis(redisHost), queue2Name);
  });

  // VAL-22: Empty DLQ operations return zero
  it('VAL-22: operations on empty DLQ return 0', async () => {
    const count = await dlqQueue.getDeadLetterCount();
    expect(count).toBe(0);

    const jobs = await dlqQueue.getDeadLetterJobs(0, 10);
    expect(jobs.length).toBe(0);

    const replayed = await dlqQueue.replayAllDeadLetters();
    expect(replayed).toBe(0);

    const purged = await dlqQueue.purgeDeadLetters();
    expect(purged).toBe(0);
  });

  // VAL-23: No regressions in existing test suite (regression guard)
  it('VAL-23: Worker without deadLetterQueue works identically to before', async () => {
    let processedCount = 0;
    const worker = new Worker(
      queueName,
      async () => {
        processedCount++;
        if (processedCount < 3) {
          throw new Error('retry me');
        }
      },
      { connection, prefix, attempts: 3 },
    );

    await queue.add('regression-job', { x: 1 }, { attempts: 3 });

    await new Promise<void>(resolve => {
      worker.on('completed', () => resolve());
    });

    const completedJobs = await queue.getCompleted(0, 10);
    expect(completedJobs.length).toBe(1);

    const dlqCount = await dlqQueue.getDeadLetterCount();
    expect(dlqCount).toBe(0);

    await worker.close();
  });
});
