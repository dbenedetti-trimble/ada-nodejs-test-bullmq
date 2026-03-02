import { default as IORedis } from 'ioredis';
import { v4 } from 'uuid';
import { after } from 'lodash';
import {
  describe,
  beforeEach,
  afterEach,
  beforeAll,
  afterAll,
  it,
  expect,
} from 'vitest';

import { Queue, QueueEvents, Worker, UnrecoverableError } from '../src/classes';
import { delay, removeAllQueueData } from '../src/utils';

describe('dead letter queue', () => {
  const redisHost = process.env.REDIS_HOST || 'localhost';
  const prefix = process.env.BULLMQ_TEST_PREFIX || 'bull';

  let queue: Queue;
  let dlqQueue: Queue;
  let queueEvents: QueueEvents;
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
    queueEvents = new QueueEvents(queueName, { connection, prefix });
    await queue.waitUntilReady();
    await dlqQueue.waitUntilReady();
    await queueEvents.waitUntilReady();
  });

  afterEach(async () => {
    await queue.close();
    await dlqQueue.close();
    await queueEvents.close();
    await removeAllQueueData(new IORedis(redisHost), queueName);
    await removeAllQueueData(new IORedis(redisHost), dlqQueueName);
  });

  afterAll(async () => {
    await connection.quit();
  });

  describe('Worker configuration (DLQ-1)', () => {
    it('VAL-01: no DLQ config - failure behavior unchanged', async () => {
      const worker = new Worker(
        queueName,
        async () => {
          throw new Error('fail');
        },
        { connection, prefix },
      );

      await queue.add('test-job', { foo: 'bar' }, { attempts: 2 });

      await new Promise<void>(resolve => {
        worker.on(
          'failed',
          after(2, async () => {
            resolve();
          }),
        );
      });

      const failedCount = await queue.getFailedCount();
      expect(failedCount).toBe(1);

      const dlqCount = await dlqQueue.getDeadLetterCount();
      expect(dlqCount).toBe(0);

      await worker.close();
    });

    it('should validate that queueName is a non-empty string', () => {
      expect(() => {
        new Worker(queueName, async () => {}, {
          connection,
          prefix,
          deadLetterQueue: { queueName: '' },
        });
      }).toThrow('deadLetterQueue.queueName must be a non-empty string');
    });
  });

  describe('Atomic DLQ movement (DLQ-2)', () => {
    it('VAL-02: job routed to DLQ after exhausting retries', async () => {
      const worker = new Worker(
        queueName,
        async () => {
          throw new Error('processing failed');
        },
        {
          connection,
          prefix,
          deadLetterQueue: { queueName: dlqQueueName },
        },
      );

      await queue.add('test-job', { orderId: 1 }, { attempts: 3 });

      await new Promise<void>(resolve => {
        worker.on(
          'failed',
          after(3, async () => {
            resolve();
          }),
        );
      });

      await delay(500);

      const failedCount = await queue.getFailedCount();
      expect(failedCount).toBe(0);

      const dlqCount = await dlqQueue.getDeadLetterCount();
      expect(dlqCount).toBe(1);

      const dlqJobs = await dlqQueue.getDeadLetterJobs(0, 0);
      expect(dlqJobs.length).toBe(1);
      expect((dlqJobs[0].data as any)._dlqMeta).toBeDefined();
      expect((dlqJobs[0].data as any)._dlqMeta.sourceQueue).toBe(queueName);
      expect((dlqJobs[0].data as any)._dlqMeta.attemptsMade).toBe(3);

      await worker.close();
    });

    it('VAL-03: UnrecoverableError goes directly to DLQ', async () => {
      const worker = new Worker(
        queueName,
        async () => {
          throw new UnrecoverableError('fatal error');
        },
        {
          connection,
          prefix,
          deadLetterQueue: { queueName: dlqQueueName },
        },
      );

      await queue.add('test-job', { data: 'test' }, { attempts: 5 });

      await new Promise<void>(resolve => {
        worker.on('failed', async () => {
          resolve();
        });
      });

      await delay(500);

      const dlqCount = await dlqQueue.getDeadLetterCount();
      expect(dlqCount).toBe(1);

      const dlqJobs = await dlqQueue.getDeadLetterJobs(0, 0);
      expect((dlqJobs[0].data as any)._dlqMeta.attemptsMade).toBe(1);
      expect((dlqJobs[0].data as any)._dlqMeta.failedReason).toBe(
        'fatal error',
      );

      await worker.close();
    });

    it('VAL-04: successful job does not go to DLQ', async () => {
      let attempts = 0;
      const worker = new Worker(
        queueName,
        async () => {
          attempts++;
          if (attempts < 3) {
            throw new Error('fail');
          }
          return 'done';
        },
        {
          connection,
          prefix,
          deadLetterQueue: { queueName: dlqQueueName },
        },
      );

      await queue.add('test-job', { data: 'test' }, { attempts: 3 });

      await new Promise<void>(resolve => {
        worker.on('completed', async () => {
          resolve();
        });
      });

      await delay(300);

      const completedCount = await queue.getCompletedCount();
      expect(completedCount).toBe(1);

      const dlqCount = await dlqQueue.getDeadLetterCount();
      expect(dlqCount).toBe(0);

      await worker.close();
    });

    it('VAL-05: retried job does not go to DLQ until retries exhausted', async () => {
      let failCount = 0;

      const worker = new Worker(
        queueName,
        async () => {
          failCount++;
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
        { data: 'test' },
        { attempts: 3, backoff: { type: 'fixed', delay: 100 } },
      );

      await new Promise<void>(resolve => {
        worker.on(
          'failed',
          after(3, () => {
            resolve();
          }),
        );
      });

      await delay(500);

      expect(failCount).toBe(3);

      const dlqCount = await dlqQueue.getDeadLetterCount();
      expect(dlqCount).toBe(1);

      await worker.close();
    });
  });

  describe('DLQ metadata (DLQ-3)', () => {
    it('VAL-06: DLQ metadata is complete', async () => {
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

      await queue.add(
        'order-job',
        { orderId: 123 },
        { attempts: 2, backoff: { type: 'fixed', delay: 100 } },
      );

      await new Promise<void>(resolve => {
        worker.on(
          'failed',
          after(2, () => {
            resolve();
          }),
        );
      });

      await delay(500);

      const dlqJobs = await dlqQueue.getDeadLetterJobs(0, 0);
      expect(dlqJobs.length).toBe(1);

      const dlqJob = dlqJobs[0];
      const data = dlqJob.data as any;
      expect(data.orderId).toBe(123);

      const meta = data._dlqMeta;
      expect(meta).toBeDefined();
      expect(meta.sourceQueue).toBe(queueName);
      expect(meta.failedReason).toBe('Connection refused');
      expect(Array.isArray(meta.stacktrace)).toBe(true);
      expect(meta.stacktrace.length).toBe(2);
      expect(meta.attemptsMade).toBe(2);
      expect(typeof meta.deadLetteredAt).toBe('number');
      expect(meta.deadLetteredAt).toBeGreaterThan(0);
      expect(typeof meta.originalTimestamp).toBe('number');
      expect(meta.originalOpts).toBeDefined();
      expect(meta.originalOpts.attempts).toBe(2);

      await worker.close();
    });

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

      await queue.add('send-email', { to: 'test@test.com' }, { attempts: 1 });

      await new Promise<void>(resolve => {
        worker.on('failed', async () => {
          resolve();
        });
      });

      await delay(500);

      const dlqJobs = await dlqQueue.getDeadLetterJobs(0, 0);
      expect(dlqJobs.length).toBe(1);
      expect(dlqJobs[0].name).toBe('send-email');

      await worker.close();
    });
  });

  describe('Events (DLQ-2)', () => {
    it('VAL-08: deadLettered event emitted', async () => {
      const worker = new Worker(
        queueName,
        async () => {
          throw new Error('event test fail');
        },
        {
          connection,
          prefix,
          deadLetterQueue: { queueName: dlqQueueName },
        },
      );

      const eventPromise = new Promise<{
        jobId: string;
        deadLetterQueue: string;
        failedReason: string;
      }>(resolve => {
        queueEvents.on('deadLettered', (args: any) => {
          resolve(args);
        });
      });

      await queue.add('test-job', { data: 'test' }, { attempts: 1 });

      const eventArgs = await eventPromise;
      expect(eventArgs.jobId).toBeDefined();
      expect(eventArgs.deadLetterQueue).toBe(dlqQueueName);
      expect(eventArgs.failedReason).toBe('event test fail');

      await worker.close();
    });
  });

  describe('DLQ inspection API (DLQ-4)', () => {
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

      for (let i = 0; i < 5; i++) {
        await queue.add(`job-${i}`, { i }, { attempts: 1 });
      }

      await new Promise<void>(resolve => {
        worker.on(
          'failed',
          after(5, () => {
            resolve();
          }),
        );
      });

      await delay(500);

      const count = await dlqQueue.getDeadLetterCount();
      expect(count).toBe(5);

      await worker.close();
    });

    it(
      'VAL-10: getDeadLetterJobs returns paginated results',
      { timeout: 30000 },
      async () => {
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

        const totalJobs = 6;
        for (let i = 0; i < totalJobs; i++) {
          await queue.add(`job-${i}`, { i }, { attempts: 1 });
        }

        await new Promise<void>(resolve => {
          worker.on(
            'failed',
            after(totalJobs, () => {
              resolve();
            }),
          );
        });

        await delay(500);

        const firstPage = await dlqQueue.getDeadLetterJobs(0, 3);
        expect(firstPage.length).toBe(4);

        const secondPage = await dlqQueue.getDeadLetterJobs(4, 5);
        expect(secondPage.length).toBe(2);

        await worker.close();
      },
    );

    it('VAL-11: peekDeadLetter returns job with metadata', async () => {
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

      await queue.add('test-job', { data: 'peek' }, { attempts: 1 });

      await new Promise<void>(resolve => {
        worker.on('failed', async () => {
          resolve();
        });
      });

      await delay(500);

      const dlqJobs = await dlqQueue.getDeadLetterJobs(0, 0);
      expect(dlqJobs.length).toBe(1);

      const peeked = await dlqQueue.peekDeadLetter(dlqJobs[0].id);
      expect(peeked).toBeDefined();
      expect((peeked.data as any)._dlqMeta).toBeDefined();
      expect((peeked.data as any)._dlqMeta.sourceQueue).toBe(queueName);

      await worker.close();
    });

    it('VAL-12: peekDeadLetter returns undefined for missing job', async () => {
      const job = await dlqQueue.peekDeadLetter('nonexistent');
      expect(job).toBeUndefined();
    });
  });

  describe('Replay from DLQ (DLQ-5)', () => {
    it('VAL-13: replayDeadLetter re-enqueues to source queue', async () => {
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

      await queue.add('test-job', { orderId: 42 }, { attempts: 1 });

      await new Promise<void>(resolve => {
        worker.on('failed', async () => {
          resolve();
        });
      });

      await delay(500);
      await worker.close();

      const dlqJobs = await dlqQueue.getDeadLetterJobs(0, 0);
      expect(dlqJobs.length).toBe(1);

      const newJobId = await dlqQueue.replayDeadLetter(dlqJobs[0].id);
      expect(newJobId).toBeDefined();
      expect(typeof newJobId).toBe('string');

      const waitingCount = await queue.getWaitingCount();
      expect(waitingCount).toBe(1);

      const waitingJobs = await queue.getWaiting(0, 0);
      expect(waitingJobs.length).toBe(1);
      expect((waitingJobs[0].data as any).orderId).toBe(42);
      expect((waitingJobs[0].data as any)._dlqMeta).toBeUndefined();

      const dlqCountAfter = await dlqQueue.getDeadLetterCount();
      expect(dlqCountAfter).toBe(0);
    });

    it('VAL-14: replayDeadLetter returns new job ID', async () => {
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

      await queue.add('test-job', { data: 'test' }, { attempts: 1 });

      await new Promise<void>(resolve => {
        worker.on('failed', async () => {
          resolve();
        });
      });

      await delay(500);
      await worker.close();

      const dlqJobs = await dlqQueue.getDeadLetterJobs(0, 0);
      const originalJobId = (dlqJobs[0].data as any)._dlqMeta.originalJobId;

      const newJobId = await dlqQueue.replayDeadLetter(dlqJobs[0].id);
      expect(newJobId).toBeDefined();
      expect(newJobId).not.toBe(originalJobId);
    });

    it('VAL-15: replayDeadLetter throws for non-existent job', async () => {
      await expect(dlqQueue.replayDeadLetter('nonexistent')).rejects.toThrow();
    });
  });

  describe('Bulk replay and purge (DLQ-6)', () => {
    it('VAL-16: replayAllDeadLetters replays all jobs', async () => {
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

      for (let i = 0; i < 3; i++) {
        await queue.add('order-job', { orderId: i }, { attempts: 1 });
      }

      await new Promise<void>(resolve => {
        worker.on(
          'failed',
          after(3, () => {
            resolve();
          }),
        );
      });

      await delay(500);
      await worker.close();

      const replayCount = await dlqQueue.replayAllDeadLetters();
      expect(replayCount).toBe(3);

      const dlqCount = await dlqQueue.getDeadLetterCount();
      expect(dlqCount).toBe(0);

      const waitingCount = await queue.getWaitingCount();
      expect(waitingCount).toBe(3);
    });

    it('VAL-17: replayAllDeadLetters with name filter', async () => {
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

      await queue.add('send-email', { to: 'a@b.com' }, { attempts: 1 });
      await queue.add('send-email', { to: 'c@d.com' }, { attempts: 1 });
      await queue.add('charge-card', { amount: 100 }, { attempts: 1 });

      await new Promise<void>(resolve => {
        worker.on(
          'failed',
          after(3, () => {
            resolve();
          }),
        );
      });

      await delay(500);
      await worker.close();

      const replayCount = await dlqQueue.replayAllDeadLetters({
        name: 'send-email',
      });
      expect(replayCount).toBe(2);

      const dlqCount = await dlqQueue.getDeadLetterCount();
      expect(dlqCount).toBe(1);

      const remaining = await dlqQueue.getDeadLetterJobs(0, 0);
      expect(remaining[0].name).toBe('charge-card');
    });

    it('VAL-18: replayAllDeadLetters with failedReason filter', async () => {
      let callCount = 0;
      const errors = ['ETIMEDOUT', 'ECONNREFUSED', 'ETIMEDOUT'];

      const worker = new Worker(
        queueName,
        async () => {
          throw new Error(errors[callCount++]);
        },
        {
          connection,
          prefix,
          deadLetterQueue: { queueName: dlqQueueName },
        },
      );

      for (let i = 0; i < 3; i++) {
        await queue.add('test-job', { i }, { attempts: 1 });
      }

      await new Promise<void>(resolve => {
        worker.on(
          'failed',
          after(3, () => {
            resolve();
          }),
        );
      });

      await delay(500);
      await worker.close();

      const replayCount = await dlqQueue.replayAllDeadLetters({
        failedReason: 'ETIMEDOUT',
      });
      expect(replayCount).toBe(2);

      const dlqCount = await dlqQueue.getDeadLetterCount();
      expect(dlqCount).toBe(1);
    });

    it('VAL-19: purgeDeadLetters removes all', async () => {
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

      for (let i = 0; i < 5; i++) {
        await queue.add('test-job', { i }, { attempts: 1 });
      }

      await new Promise<void>(resolve => {
        worker.on(
          'failed',
          after(5, () => {
            resolve();
          }),
        );
      });

      await delay(500);
      await worker.close();

      const purgeCount = await dlqQueue.purgeDeadLetters();
      expect(purgeCount).toBe(5);

      const dlqCount = await dlqQueue.getDeadLetterCount();
      expect(dlqCount).toBe(0);
    });

    it('VAL-20: purgeDeadLetters with filter', async () => {
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

      await queue.add('send-email', { to: 'a@b.com' }, { attempts: 1 });
      await queue.add('send-email', { to: 'c@d.com' }, { attempts: 1 });
      await queue.add('charge-card', { amount: 100 }, { attempts: 1 });

      await new Promise<void>(resolve => {
        worker.on(
          'failed',
          after(3, () => {
            resolve();
          }),
        );
      });

      await delay(500);
      await worker.close();

      const purgeCount = await dlqQueue.purgeDeadLetters({
        name: 'send-email',
      });
      expect(purgeCount).toBe(2);

      const dlqCount = await dlqQueue.getDeadLetterCount();
      expect(dlqCount).toBe(1);

      const remaining = await dlqQueue.getDeadLetterJobs(0, 0);
      expect(remaining[0].name).toBe('charge-card');
    });

    it(
      'VAL-21: bulk replay handles multiple source queues',
      { timeout: 20000 },
      async () => {
        const queue2Name = `test-${v4()}`;
        const queue2 = new Queue(queue2Name, { connection, prefix });
        await queue2.waitUntilReady();

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

        await queue.add('job-from-q1', { src: 'q1' }, { attempts: 1 });
        await queue.add('job-from-q1b', { src: 'q1' }, { attempts: 1 });
        await queue2.add('job-from-q2', { src: 'q2' }, { attempts: 1 });

        await new Promise<void>(resolve => {
          let count = 0;
          const check = () => {
            count++;
            if (count >= 3) {
              resolve();
            }
          };
          worker1.on('failed', check);
          worker2.on('failed', check);
        });

        await delay(500);
        await worker1.close();
        await worker2.close();

        let dlqCount = 0;
        for (let i = 0; i < 20; i++) {
          dlqCount = await dlqQueue.getDeadLetterCount();
          if (dlqCount === 3) {break;}
          await delay(250);
        }
        expect(dlqCount).toBe(3);

        const replayCount = await dlqQueue.replayAllDeadLetters();
        expect(replayCount).toBe(3);

        const dlqCountAfter = await dlqQueue.getDeadLetterCount();
        expect(dlqCountAfter).toBe(0);

        const q1Waiting = await queue.getWaitingCount();
        const q2Waiting = await queue2.getWaitingCount();
        expect(q1Waiting).toBe(2);
        expect(q2Waiting).toBe(1);

        await queue2.close();
        await removeAllQueueData(new IORedis(redisHost), queue2Name);
      },
    );
  });

  describe('Edge cases', () => {
    it('VAL-22: empty DLQ operations return zero', async () => {
      const count = await dlqQueue.getDeadLetterCount();
      expect(count).toBe(0);

      const replayCount = await dlqQueue.replayAllDeadLetters();
      expect(replayCount).toBe(0);

      const purgeCount = await dlqQueue.purgeDeadLetters();
      expect(purgeCount).toBe(0);
    });
  });
});
