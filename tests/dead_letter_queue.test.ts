'use strict';

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
import {
  Job,
  Queue,
  QueueEvents,
  UnrecoverableError,
  Worker,
} from '../src/classes';
import { delay, removeAllQueueData } from '../src/utils';

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
    dlqName = `test-dlq-${v4()}`;
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

  // VAL-01: DLQ not configured — failure behavior unchanged
  it('VAL-01: job goes to failed set when no DLQ is configured', async () => {
    const worker = new Worker(
      queueName,
      async () => {
        throw new Error('intentional failure');
      },
      { connection, prefix },
    );
    await worker.waitUntilReady();

    const failed = new Promise<void>((resolve, reject) => {
      worker.once('failed', async (job, _err) => {
        try {
          const state = await job!.getState();
          expect(state).toBe('failed');
          resolve();
        } catch (e) {
          reject(e);
        }
      });
    });

    await queue.add('test', {}, { attempts: 1 });
    await failed;
    await worker.close();
  });

  // VAL-02: Job routed to DLQ after exhausting retries
  it('VAL-02: job is routed to DLQ after retries are exhausted', async () => {
    const worker = new Worker(
      queueName,
      async () => {
        throw new Error('always fails');
      },
      {
        connection,
        prefix,
        deadLetterQueue: { queueName: dlqName },
      },
    );
    await worker.waitUntilReady();

    let failCount = 0;
    const terminal = new Promise<void>((resolve, reject) => {
      worker.on('failed', async (_job, _err) => {
        failCount++;
        if (failCount >= 2) {
          try {
            await delay(50);
            const dlqCount = await dlqQueue.getDeadLetterCount();
            expect(dlqCount).toBe(1);
            resolve();
          } catch (e) {
            reject(e);
          }
        }
      });
    });

    await queue.add('test', { value: 1 }, { attempts: 2 });
    await terminal;
    await worker.close();
  });

  // VAL-03: UnrecoverableError goes directly to DLQ
  it('VAL-03: UnrecoverableError routes job to DLQ after 1 attempt', async () => {
    const worker = new Worker(
      queueName,
      async () => {
        throw new UnrecoverableError('unrecoverable');
      },
      {
        connection,
        prefix,
        deadLetterQueue: { queueName: dlqName },
      },
    );
    await worker.waitUntilReady();

    const failed = new Promise<void>((resolve, reject) => {
      worker.once('failed', async (_job, _err) => {
        try {
          await delay(50);
          const dlqCount = await dlqQueue.getDeadLetterCount();
          expect(dlqCount).toBe(1);

          const failedCount = await queue.getFailedCount();
          expect(failedCount).toBe(0);
          resolve();
        } catch (e) {
          reject(e);
        }
      });
    });

    await queue.add('test', {}, { attempts: 5 });
    await failed;
    await worker.close();
  });

  // VAL-04: Successful job does not go to DLQ
  it('VAL-04: successful job does not end up in the DLQ', async () => {
    const worker = new Worker(queueName, async () => 'done', {
      connection,
      prefix,
      deadLetterQueue: { queueName: dlqName },
    });
    await worker.waitUntilReady();

    const completed = new Promise<void>((resolve, reject) => {
      worker.once('completed', async () => {
        try {
          const dlqCount = await dlqQueue.getDeadLetterCount();
          expect(dlqCount).toBe(0);
          resolve();
        } catch (e) {
          reject(e);
        }
      });
    });

    await queue.add('test', {});
    await completed;
    await worker.close();
  });

  // VAL-05: Retried job does not go to DLQ until retries exhausted
  it('VAL-05: job with remaining retries is not dead-lettered until exhausted', async () => {
    let attemptCount = 0;
    const worker = new Worker(
      queueName,
      async () => {
        attemptCount++;
        throw new Error('fail');
      },
      {
        connection,
        prefix,
        deadLetterQueue: { queueName: dlqName },
      },
    );
    await worker.waitUntilReady();

    const terminal = new Promise<void>((resolve, reject) => {
      worker.on('failed', async (_job, _err) => {
        if (attemptCount >= 3) {
          try {
            await delay(50);
            const dlqCount = await dlqQueue.getDeadLetterCount();
            expect(dlqCount).toBe(1);
            const failedCount = await queue.getFailedCount();
            expect(failedCount).toBe(0);
            resolve();
          } catch (e) {
            reject(e);
          }
        }
      });
    });

    await queue.add('test', {}, { attempts: 3 });
    await terminal;
    await worker.close();
  });

  // VAL-06: DLQ metadata is complete
  it('VAL-06: DLQ job data contains complete _dlqMeta', async () => {
    const originalData = { key: 'value' };
    const worker = new Worker(
      queueName,
      async () => {
        throw new Error('metadata-test-error');
      },
      {
        connection,
        prefix,
        deadLetterQueue: { queueName: dlqName },
      },
    );
    await worker.waitUntilReady();

    const failed = new Promise<void>((resolve, reject) => {
      worker.once('failed', async (_job, _err) => {
        try {
          await delay(50);
          const dlqJobs = await dlqQueue.getDeadLetterJobs(0, -1);
          expect(dlqJobs).toHaveLength(1);

          const dlqJob = dlqJobs[0];
          const meta = (dlqJob.data as any)._dlqMeta;

          expect(meta).toBeDefined();
          expect(meta.sourceQueue).toBe(queueName);
          expect(meta.originalJobId).toBeDefined();
          expect(meta.failedReason).toBe('metadata-test-error');
          expect(Array.isArray(meta.stacktrace)).toBe(true);
          expect(typeof meta.attemptsMade).toBe('number');
          expect(typeof meta.deadLetteredAt).toBe('number');
          expect(typeof meta.originalTimestamp).toBe('number');
          expect(meta.originalOpts).toBeDefined();
          resolve();
        } catch (e) {
          reject(e);
        }
      });
    });

    await queue.add('test', originalData, { attempts: 1 });
    await failed;
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
        deadLetterQueue: { queueName: dlqName },
      },
    );
    await worker.waitUntilReady();

    const failed = new Promise<void>((resolve, reject) => {
      worker.once('failed', async (_job, _err) => {
        try {
          await delay(50);
          const dlqJobs = await dlqQueue.getDeadLetterJobs(0, -1);
          expect(dlqJobs).toHaveLength(1);
          expect(dlqJobs[0].name).toBe('my-job-name');
          resolve();
        } catch (e) {
          reject(e);
        }
      });
    });

    await queue.add('my-job-name', {}, { attempts: 1 });
    await failed;
    await worker.close();
  });

  // VAL-08: deadLettered event emitted
  it('VAL-08: deadLettered event is emitted on the source queue events stream', async () => {
    const queueEvents = new QueueEvents(queueName, { connection, prefix });
    await queueEvents.waitUntilReady();

    const worker = new Worker(
      queueName,
      async () => {
        throw new Error('event-test-error');
      },
      {
        connection,
        prefix,
        deadLetterQueue: { queueName: dlqName },
      },
    );
    await worker.waitUntilReady();

    const eventReceived = new Promise<void>((resolve, reject) => {
      (queueEvents as any).once(
        'deadLettered',
        (args: {
          jobId: string;
          deadLetterQueue: string;
          failedReason: string;
        }) => {
          try {
            expect(args.jobId).toBeDefined();
            expect(args.deadLetterQueue).toBe(dlqName);
            expect(args.failedReason).toBe('event-test-error');
            resolve();
          } catch (e) {
            reject(e);
          }
        },
      );
    });

    await queue.add('test', {}, { attempts: 1 });
    await eventReceived;

    await queueEvents.close();
    await worker.close();
  });

  // VAL-09: getDeadLetterCount returns correct count
  it('VAL-09: getDeadLetterCount returns number of dead-lettered jobs', async () => {
    const worker = new Worker(
      queueName,
      async () => {
        throw new Error('fail');
      },
      {
        connection,
        prefix,
        deadLetterQueue: { queueName: dlqName },
      },
    );
    await worker.waitUntilReady();

    let failedCount = 0;
    const allFailed = new Promise<void>((resolve, reject) => {
      worker.on('failed', async () => {
        failedCount++;
        if (failedCount >= 3) {
          try {
            await delay(50);
            const count = await dlqQueue.getDeadLetterCount();
            expect(count).toBe(3);
            resolve();
          } catch (e) {
            reject(e);
          }
        }
      });
    });

    await queue.add('test', { n: 1 }, { attempts: 1 });
    await queue.add('test', { n: 2 }, { attempts: 1 });
    await queue.add('test', { n: 3 }, { attempts: 1 });
    await allFailed;
    await worker.close();
  });

  // VAL-10: getDeadLetterJobs returns paginated results
  it('VAL-10: getDeadLetterJobs returns paginated job list', async () => {
    const worker = new Worker(
      queueName,
      async () => {
        throw new Error('fail');
      },
      {
        connection,
        prefix,
        deadLetterQueue: { queueName: dlqName },
      },
    );
    await worker.waitUntilReady();

    let failedCount = 0;
    const allFailed = new Promise<void>((resolve, reject) => {
      worker.on('failed', async () => {
        failedCount++;
        if (failedCount >= 3) {
          try {
            await delay(50);
            const firstPage = await dlqQueue.getDeadLetterJobs(0, 1);
            expect(firstPage).toHaveLength(2);

            const allJobs = await dlqQueue.getDeadLetterJobs(0, -1);
            expect(allJobs).toHaveLength(3);
            resolve();
          } catch (e) {
            reject(e);
          }
        }
      });
    });

    await queue.add('test', { n: 1 }, { attempts: 1 });
    await queue.add('test', { n: 2 }, { attempts: 1 });
    await queue.add('test', { n: 3 }, { attempts: 1 });
    await allFailed;
    await worker.close();
  });

  // VAL-11: peekDeadLetter returns job with metadata
  it('VAL-11: peekDeadLetter returns the job with _dlqMeta intact', async () => {
    const worker = new Worker(
      queueName,
      async () => {
        throw new Error('peek-error');
      },
      {
        connection,
        prefix,
        deadLetterQueue: { queueName: dlqName },
      },
    );
    await worker.waitUntilReady();

    const failed = new Promise<void>((resolve, reject) => {
      worker.once('failed', async (_job, _err) => {
        try {
          await delay(50);
          const dlqJobs = await dlqQueue.getDeadLetterJobs(0, 0);
          expect(dlqJobs).toHaveLength(1);

          const peeked = await dlqQueue.peekDeadLetter(dlqJobs[0].id!);
          expect(peeked).toBeDefined();
          expect((peeked!.data as any)._dlqMeta).toBeDefined();
          expect((peeked!.data as any)._dlqMeta.failedReason).toBe(
            'peek-error',
          );
          resolve();
        } catch (e) {
          reject(e);
        }
      });
    });

    await queue.add('test', {}, { attempts: 1 });
    await failed;
    await worker.close();
  });

  // VAL-12: peekDeadLetter returns undefined for missing job
  it('VAL-12: peekDeadLetter returns undefined for a non-existent job ID', async () => {
    const result = await dlqQueue.peekDeadLetter('non-existent-job-id-12345');
    expect(result).toBeUndefined();
  });

  // VAL-13: replayDeadLetter re-enqueues to source queue
  it('VAL-13: replayDeadLetter moves job back to source queue waiting state', async () => {
    const worker = new Worker(
      queueName,
      async () => {
        throw new Error('fail');
      },
      {
        connection,
        prefix,
        deadLetterQueue: { queueName: dlqName },
      },
    );
    await worker.waitUntilReady();

    const failed = new Promise<void>(resolve => {
      worker.once('failed', () => resolve());
    });

    await queue.add('test', { data: 'original' }, { attempts: 1 });
    await failed;
    await worker.close();
    await delay(50);

    const dlqJobs = await dlqQueue.getDeadLetterJobs(0, -1);
    expect(dlqJobs).toHaveLength(1);
    const dlqJobId = dlqJobs[0].id!;

    await dlqQueue.replayDeadLetter(dlqJobId);

    const dlqCountAfter = await dlqQueue.getDeadLetterCount();
    expect(dlqCountAfter).toBe(0);

    const waitingCount = await queue.getWaitingCount();
    expect(waitingCount).toBe(1);
  });

  // VAL-14: replayDeadLetter returns new job ID
  it('VAL-14: replayDeadLetter returns a new job ID different from the original', async () => {
    const worker = new Worker(
      queueName,
      async () => {
        throw new Error('fail');
      },
      {
        connection,
        prefix,
        deadLetterQueue: { queueName: dlqName },
      },
    );
    await worker.waitUntilReady();

    const failed = new Promise<void>(resolve => {
      worker.once('failed', () => resolve());
    });

    const originalJob = await queue.add('test', {}, { attempts: 1 });
    await failed;
    await worker.close();
    await delay(50);

    const dlqJobs = await dlqQueue.getDeadLetterJobs(0, -1);
    const dlqJobId = dlqJobs[0].id!;

    const newJobId = await dlqQueue.replayDeadLetter(dlqJobId);

    expect(newJobId).toBeDefined();
    expect(newJobId).not.toBe(originalJob.id);
    expect(newJobId).not.toBe(dlqJobId);
  });

  // VAL-15: replayDeadLetter throws for non-existent job
  it('VAL-15: replayDeadLetter throws when job ID does not exist in DLQ', async () => {
    await expect(
      dlqQueue.replayDeadLetter('non-existent-id-99999'),
    ).rejects.toThrow();
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
        deadLetterQueue: { queueName: dlqName },
      },
    );
    await worker.waitUntilReady();

    let failedCount = 0;
    const allFailed = new Promise<void>(resolve => {
      worker.on('failed', () => {
        failedCount++;
        if (failedCount >= 2) {
          resolve();
        }
      });
    });

    await queue.add('test', { n: 1 }, { attempts: 1 });
    await queue.add('test', { n: 2 }, { attempts: 1 });
    await allFailed;
    await worker.close();
    await delay(50);

    expect(await dlqQueue.getDeadLetterCount()).toBe(2);

    const replayed = await dlqQueue.replayAllDeadLetters();
    expect(replayed).toBe(2);

    expect(await dlqQueue.getDeadLetterCount()).toBe(0);
    const waitingCount = await queue.getWaitingCount();
    expect(waitingCount).toBe(2);
  });

  // VAL-17: replayAllDeadLetters with name filter
  it('VAL-17: replayAllDeadLetters({ name }) only replays matching jobs', async () => {
    const worker = new Worker(
      queueName,
      async () => {
        throw new Error('fail');
      },
      {
        connection,
        prefix,
        deadLetterQueue: { queueName: dlqName },
      },
    );
    await worker.waitUntilReady();

    let failedCount = 0;
    const allFailed = new Promise<void>(resolve => {
      worker.on('failed', () => {
        failedCount++;
        if (failedCount >= 3) {
          resolve();
        }
      });
    });

    await queue.add('alpha', {}, { attempts: 1 });
    await queue.add('beta', {}, { attempts: 1 });
    await queue.add('alpha', {}, { attempts: 1 });
    await allFailed;
    await worker.close();
    await delay(50);

    expect(await dlqQueue.getDeadLetterCount()).toBe(3);

    const replayed = await dlqQueue.replayAllDeadLetters({ name: 'alpha' });
    expect(replayed).toBe(2);

    expect(await dlqQueue.getDeadLetterCount()).toBe(1);
    const waitingCount = await queue.getWaitingCount();
    expect(waitingCount).toBe(2);
  });

  // VAL-18: replayAllDeadLetters with failedReason filter
  it('VAL-18: replayAllDeadLetters({ failedReason }) matches by substring', async () => {
    let callCount = 0;
    const worker = new Worker(
      queueName,
      async job => {
        callCount++;
        if (callCount <= 2) {
          throw new Error('network timeout occurred');
        }
        throw new Error('validation error');
      },
      {
        connection,
        prefix,
        deadLetterQueue: { queueName: dlqName },
      },
    );
    await worker.waitUntilReady();

    let failedCount = 0;
    const allFailed = new Promise<void>(resolve => {
      worker.on('failed', () => {
        failedCount++;
        if (failedCount >= 3) {
          resolve();
        }
      });
    });

    await queue.add('test', {}, { attempts: 1 });
    await queue.add('test', {}, { attempts: 1 });
    await queue.add('test', {}, { attempts: 1 });
    await allFailed;
    await worker.close();
    await delay(50);

    expect(await dlqQueue.getDeadLetterCount()).toBe(3);

    const replayed = await dlqQueue.replayAllDeadLetters({
      failedReason: 'network',
    });
    expect(replayed).toBe(2);
    expect(await dlqQueue.getDeadLetterCount()).toBe(1);
  });

  // VAL-19: purgeDeadLetters removes all
  it('VAL-19: purgeDeadLetters() removes all jobs and returns count', async () => {
    const worker = new Worker(
      queueName,
      async () => {
        throw new Error('fail');
      },
      {
        connection,
        prefix,
        deadLetterQueue: { queueName: dlqName },
      },
    );
    await worker.waitUntilReady();

    let failedCount = 0;
    const allFailed = new Promise<void>(resolve => {
      worker.on('failed', () => {
        failedCount++;
        if (failedCount >= 3) {
          resolve();
        }
      });
    });

    await queue.add('test', { n: 1 }, { attempts: 1 });
    await queue.add('test', { n: 2 }, { attempts: 1 });
    await queue.add('test', { n: 3 }, { attempts: 1 });
    await allFailed;
    await worker.close();
    await delay(50);

    expect(await dlqQueue.getDeadLetterCount()).toBe(3);

    const removed = await dlqQueue.purgeDeadLetters();
    expect(removed).toBe(3);
    expect(await dlqQueue.getDeadLetterCount()).toBe(0);
  });

  // VAL-20: purgeDeadLetters with filter
  it('VAL-20: purgeDeadLetters({ name }) only removes matching jobs', async () => {
    const worker = new Worker(
      queueName,
      async () => {
        throw new Error('fail');
      },
      {
        connection,
        prefix,
        deadLetterQueue: { queueName: dlqName },
      },
    );
    await worker.waitUntilReady();

    let failedCount = 0;
    const allFailed = new Promise<void>(resolve => {
      worker.on('failed', () => {
        failedCount++;
        if (failedCount >= 3) {
          resolve();
        }
      });
    });

    await queue.add('removable', {}, { attempts: 1 });
    await queue.add('keep', {}, { attempts: 1 });
    await queue.add('removable', {}, { attempts: 1 });
    await allFailed;
    await worker.close();
    await delay(50);

    expect(await dlqQueue.getDeadLetterCount()).toBe(3);

    const removed = await dlqQueue.purgeDeadLetters({ name: 'removable' });
    expect(removed).toBe(2);
    expect(await dlqQueue.getDeadLetterCount()).toBe(1);

    const remaining = await dlqQueue.getDeadLetterJobs(0, -1);
    expect(remaining[0].name).toBe('keep');
  });

  // VAL-21: Bulk replay handles multiple source queues
  it('VAL-21: replayAllDeadLetters routes jobs to correct source queues', async () => {
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
        deadLetterQueue: { queueName: dlqName },
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
        deadLetterQueue: { queueName: dlqName },
      },
    );

    await worker1.waitUntilReady();
    await worker2.waitUntilReady();

    const failed1 = new Promise<void>(resolve => {
      worker1.once('failed', () => resolve());
    });
    const failed2 = new Promise<void>(resolve => {
      worker2.once('failed', () => resolve());
    });

    await queue.add('job-a', {}, { attempts: 1 });
    await queue2.add('job-b', {}, { attempts: 1 });
    await Promise.all([failed1, failed2]);
    await delay(50);

    expect(await dlqQueue.getDeadLetterCount()).toBe(2);

    const replayed = await dlqQueue.replayAllDeadLetters();
    expect(replayed).toBe(2);

    expect(await dlqQueue.getDeadLetterCount()).toBe(0);

    const q1Waiting = await queue.getWaitingCount();
    const q2Waiting = await queue2.getWaitingCount();
    expect(q1Waiting).toBe(1);
    expect(q2Waiting).toBe(1);

    await worker1.close();
    await worker2.close();
    await queue2.close();
    await removeAllQueueData(new IORedis(redisHost), queue2Name);
  });

  // VAL-22: Empty DLQ operations return zero
  it('VAL-22: all bulk operations return 0 for an empty DLQ', async () => {
    const count = await dlqQueue.getDeadLetterCount();
    expect(count).toBe(0);

    const jobs = await dlqQueue.getDeadLetterJobs(0, -1);
    expect(jobs).toHaveLength(0);

    const replayed = await dlqQueue.replayAllDeadLetters();
    expect(replayed).toBe(0);

    const purged = await dlqQueue.purgeDeadLetters();
    expect(purged).toBe(0);
  });

  // VAL-23: No regressions in existing test suite (verified by running `yarn test`)
});
