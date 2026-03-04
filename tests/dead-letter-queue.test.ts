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
  Queue,
  QueueEvents,
  Job,
  UnrecoverableError,
  Worker,
} from '../src/classes';
import { delay, removeAllQueueData } from '../src/utils';

describe('Dead Letter Queue', () => {
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

  describe('DLQ-1: Worker dead letter queue configuration', () => {
    it('should accept deadLetterQueue option with a queueName string', async () => {
      const worker = new Worker(queueName, async () => {}, {
        connection,
        prefix,
        deadLetterQueue: { queueName: dlqQueueName },
      });

      expect(worker.opts.deadLetterQueue).toEqual({
        queueName: dlqQueueName,
      });

      await worker.close();
    });

    it('should throw if deadLetterQueue.queueName is empty', () => {
      expect(() => {
        new Worker(queueName, async () => {}, {
          connection,
          prefix,
          deadLetterQueue: { queueName: '' },
        });
      }).toThrow('deadLetterQueue.queueName must be a non-empty string');
    });

    it('should preserve current failure behavior when deadLetterQueue is not configured', async () => {
      const worker = new Worker(
        queueName,
        async () => {
          throw new Error('fail');
        },
        { connection, prefix },
      );
      await worker.waitUntilReady();

      const failedPromise = new Promise<Job>(resolve => {
        worker.on('failed', job => {
          resolve(job!);
        });
      });

      await queue.add('test', { foo: 'bar' }, { attempts: 1 });

      const failedJob = await failedPromise;
      expect(failedJob).toBeDefined();

      const failedCount = await queue.getJobCountByTypes('failed');
      expect(failedCount).toBe(1);

      const dlqCount = await dlqQueue.getDeadLetterCount();
      expect(dlqCount).toBe(0);

      await worker.close();
    });
  });

  describe('DLQ-2: Atomic job movement to DLQ on terminal failure', () => {
    it('should move job to DLQ after exhausting retries', async () => {
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
      await worker.waitUntilReady();

      const deadLetteredPromise = new Promise<Job>(resolve => {
        worker.on('deadLettered', job => {
          resolve(job);
        });
      });

      await queue.add('test', { key: 'value' }, { attempts: 3 });

      const dlqJob = await deadLetteredPromise;
      expect(dlqJob).toBeDefined();

      await delay(200);

      const failedCount = await queue.getJobCountByTypes('failed');
      expect(failedCount).toBe(0);

      const dlqCount = await dlqQueue.getDeadLetterCount();
      expect(dlqCount).toBe(1);

      const dlqJobs = await dlqQueue.getDeadLetterJobs(0, 10);
      expect(dlqJobs.length).toBe(1);
      expect((dlqJobs[0].data as any).key).toBe('value');
      expect((dlqJobs[0].data as any)._dlqMeta).toBeDefined();
      expect((dlqJobs[0].data as any)._dlqMeta.sourceQueue).toBe(queueName);

      await worker.close();
    });

    it('should move job to DLQ immediately on UnrecoverableError', async () => {
      const worker = new Worker(
        queueName,
        async () => {
          throw new UnrecoverableError('permanent failure');
        },
        {
          connection,
          prefix,
          deadLetterQueue: { queueName: dlqQueueName },
        },
      );
      await worker.waitUntilReady();

      const deadLetteredPromise = new Promise<Job>(resolve => {
        worker.on('deadLettered', job => {
          resolve(job);
        });
      });

      await queue.add('test', { data: 1 }, { attempts: 5 });

      const dlqJob = await deadLetteredPromise;
      expect(dlqJob).toBeDefined();

      await delay(200);

      const dlqCount = await dlqQueue.getDeadLetterCount();
      expect(dlqCount).toBe(1);

      const dlqJobs = await dlqQueue.getDeadLetterJobs();
      expect((dlqJobs[0].data as any)._dlqMeta.attemptsMade).toBe(1);

      await worker.close();
    });

    it('should NOT move job to DLQ if it succeeds before exhausting retries', async () => {
      let attempt = 0;
      const worker = new Worker(
        queueName,
        async () => {
          attempt++;
          if (attempt < 3) {
            throw new Error('transient failure');
          }
          return 'success';
        },
        {
          connection,
          prefix,
          deadLetterQueue: { queueName: dlqQueueName },
        },
      );
      await worker.waitUntilReady();

      const completedPromise = new Promise<Job>(resolve => {
        worker.on('completed', job => {
          resolve(job);
        });
      });

      await queue.add('test', { data: 1 }, { attempts: 3 });

      const completedJob = await completedPromise;
      expect(completedJob).toBeDefined();

      const dlqCount = await dlqQueue.getDeadLetterCount();
      expect(dlqCount).toBe(0);

      await worker.close();
    });

    it('should emit deadLettered event on source queue events stream', async () => {
      const queueEvents = new QueueEvents(queueName, { connection, prefix });
      await queueEvents.waitUntilReady();

      const worker = new Worker(
        queueName,
        async () => {
          throw new Error('fail for dlq');
        },
        {
          connection,
          prefix,
          deadLetterQueue: { queueName: dlqQueueName },
        },
      );
      await worker.waitUntilReady();

      const deadLetteredEventPromise = new Promise<{
        jobId: string;
        deadLetterQueue: string;
        failedReason: string;
      }>(resolve => {
        queueEvents.on('deadLettered', (args: any) => {
          resolve(args);
        });
      });

      await queue.add('test', { data: 1 }, { attempts: 1 });

      const event = await deadLetteredEventPromise;
      expect(event.jobId).toBeDefined();
      expect(event.deadLetterQueue).toBe(dlqQueueName);
      expect(event.failedReason).toBe('fail for dlq');

      await worker.close();
      await queueEvents.close();
    });
  });

  describe('DLQ-3: DLQ job metadata', () => {
    it('should preserve original job data and add _dlqMeta', async () => {
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
      await worker.waitUntilReady();

      const deadLetteredPromise = new Promise<void>(resolve => {
        worker.on('deadLettered', () => resolve());
      });

      await queue.add(
        'send-email',
        { orderId: 123, email: 'test@test.com' },
        { attempts: 2 },
      );

      await deadLetteredPromise;
      await delay(200);

      const dlqJobs = await dlqQueue.getDeadLetterJobs();
      expect(dlqJobs.length).toBe(1);

      const dlqData = dlqJobs[0].data as any;
      expect(dlqData.orderId).toBe(123);
      expect(dlqData.email).toBe('test@test.com');
      expect(dlqData._dlqMeta).toBeDefined();

      await worker.close();
    });

    it('should include complete failure context in _dlqMeta', async () => {
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
      await worker.waitUntilReady();

      const deadLetteredPromise = new Promise<void>(resolve => {
        worker.on('deadLettered', () => resolve());
      });

      const jobOpts = { attempts: 2 };
      await queue.add('test-job', { orderId: 123 }, jobOpts);

      await deadLetteredPromise;
      await delay(200);

      const dlqJobs = await dlqQueue.getDeadLetterJobs();
      const meta = (dlqJobs[0].data as any)._dlqMeta;

      expect(meta.sourceQueue).toBe(queueName);
      expect(meta.failedReason).toBe('Connection refused');
      expect(Array.isArray(meta.stacktrace)).toBe(true);
      expect(meta.stacktrace.length).toBe(2);
      expect(meta.attemptsMade).toBe(2);
      expect(typeof meta.deadLetteredAt).toBe('number');
      expect(meta.deadLetteredAt).toBeGreaterThan(0);
      expect(typeof meta.originalTimestamp).toBe('number');
      expect(meta.originalOpts).toBeDefined();
      expect(meta.originalJobId).toBeDefined();

      await worker.close();
    });

    it('should preserve original job name on DLQ job', async () => {
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
      await worker.waitUntilReady();

      const deadLetteredPromise = new Promise<void>(resolve => {
        worker.on('deadLettered', () => resolve());
      });

      await queue.add('send-email', { data: 1 }, { attempts: 1 });

      await deadLetteredPromise;
      await delay(200);

      const dlqJobs = await dlqQueue.getDeadLetterJobs();
      expect(dlqJobs[0].name).toBe('send-email');

      await worker.close();
    });
  });

  describe('DLQ-4: DLQ inspection API', () => {
    async function addJobsToDLQ(count: number, jobName = 'test') {
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
      await worker.waitUntilReady();

      let deadLettered = 0;
      const allDonePromise = new Promise<void>(resolve => {
        worker.on('deadLettered', () => {
          deadLettered++;
          if (deadLettered >= count) {
            resolve();
          }
        });
      });

      for (let i = 0; i < count; i++) {
        await queue.add(jobName, { index: i }, { attempts: 1 });
      }

      await allDonePromise;
      await delay(200);
      await worker.close();
    }

    it('should return correct count via getDeadLetterCount()', async () => {
      await addJobsToDLQ(5);

      const count = await dlqQueue.getDeadLetterCount();
      expect(count).toBe(5);
    });

    it('should return paginated results via getDeadLetterJobs()', async () => {
      await addJobsToDLQ(5);

      const firstPage = await dlqQueue.getDeadLetterJobs(0, 2);
      expect(firstPage.length).toBe(3);

      const secondPage = await dlqQueue.getDeadLetterJobs(3, 4);
      expect(secondPage.length).toBe(2);
    });

    it('should return job with metadata via peekDeadLetter()', async () => {
      await addJobsToDLQ(1);

      const dlqJobs = await dlqQueue.getDeadLetterJobs();
      const job = await dlqQueue.peekDeadLetter(dlqJobs[0].id!);

      expect(job).toBeDefined();
      expect((job!.data as any)._dlqMeta).toBeDefined();
      expect((job!.data as any)._dlqMeta.sourceQueue).toBe(queueName);
    });

    it('should return undefined for non-existent job via peekDeadLetter()', async () => {
      const job = await dlqQueue.peekDeadLetter('nonexistent');
      expect(job).toBeUndefined();
    });
  });

  describe('DLQ-5: Replay from DLQ', () => {
    async function setupDLQJob(jobName = 'test', data = { key: 'value' }) {
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
      await worker.waitUntilReady();

      const deadLetteredPromise = new Promise<void>(resolve => {
        worker.on('deadLettered', () => resolve());
      });

      const originalJob = await queue.add(jobName, data, { attempts: 1 });

      await deadLetteredPromise;
      await delay(200);
      await worker.close();

      return originalJob;
    }

    it('should replay a dead-lettered job back to source queue', async () => {
      await setupDLQJob();

      const dlqJobs = await dlqQueue.getDeadLetterJobs();
      expect(dlqJobs.length).toBe(1);

      const newJobId = await dlqQueue.replayDeadLetter(dlqJobs[0].id!);
      expect(newJobId).toBeDefined();
      expect(typeof newJobId).toBe('string');

      await delay(100);

      const waitingCount = await queue.getJobCountByTypes('waiting');
      expect(waitingCount).toBe(1);

      const replayedJob = await queue.getJob(newJobId);
      expect(replayedJob).toBeDefined();
      expect((replayedJob!.data as any).key).toBe('value');
      expect((replayedJob!.data as any)._dlqMeta).toBeUndefined();

      const dlqCount = await dlqQueue.getDeadLetterCount();
      expect(dlqCount).toBe(0);
    });

    it('should return a new job ID different from the original', async () => {
      const originalJob = await setupDLQJob();

      const dlqJobs = await dlqQueue.getDeadLetterJobs();
      const newJobId = await dlqQueue.replayDeadLetter(dlqJobs[0].id!);

      expect(newJobId).not.toBe(originalJob.id);
    });

    it('should throw for non-existent job ID', async () => {
      await expect(
        dlqQueue.replayDeadLetter('nonexistent'),
      ).rejects.toThrow('Dead letter job nonexistent not found');
    });

    it('should throw if source queue cannot be determined', async () => {
      const client = await dlqQueue.client;
      const jobId = 'no-meta-job';
      const jobKey = `${prefix}:${dlqQueueName}:${jobId}`;
      await client.hmset(jobKey, {
        name: 'test',
        data: JSON.stringify({ noMeta: true }),
        opts: '{}',
        timestamp: Date.now().toString(),
        delay: '0',
        priority: '0',
      });
      await client.lpush(`${prefix}:${dlqQueueName}:wait`, jobId);

      await expect(dlqQueue.replayDeadLetter(jobId)).rejects.toThrow(
        'has no source queue metadata',
      );

      await client.del(jobKey);
      await client.lrem(`${prefix}:${dlqQueueName}:wait`, 0, jobId);
    });
  });

  describe('DLQ-6: Bulk replay and purge', () => {
    async function addMultipleJobsToDLQ(
      jobs: { name: string; data: any; error: string }[],
    ) {
      const errorMap = new Map<number, string>();
      jobs.forEach((j, i) => errorMap.set(i, j.error));

      const worker = new Worker(
        queueName,
        async job => {
          const idx = (job.data as any).idx;
          throw new Error(errorMap.get(idx) || 'fail');
        },
        {
          connection,
          prefix,
          deadLetterQueue: { queueName: dlqQueueName },
        },
      );
      await worker.waitUntilReady();

      let deadLettered = 0;
      const allDonePromise = new Promise<void>(resolve => {
        worker.on('deadLettered', () => {
          deadLettered++;
          if (deadLettered >= jobs.length) {
            resolve();
          }
        });
      });

      for (let i = 0; i < jobs.length; i++) {
        await queue.add(
          jobs[i].name,
          { ...jobs[i].data, idx: i },
          { attempts: 1 },
        );
      }

      await allDonePromise;
      await delay(200);
      await worker.close();
    }

    it('should replay all dead-lettered jobs', async () => {
      await addMultipleJobsToDLQ([
        { name: 'job1', data: { a: 1 }, error: 'fail1' },
        { name: 'job2', data: { b: 2 }, error: 'fail2' },
        { name: 'job3', data: { c: 3 }, error: 'fail3' },
      ]);

      const count = await dlqQueue.replayAllDeadLetters();
      expect(count).toBe(3);

      await delay(100);

      const dlqCount = await dlqQueue.getDeadLetterCount();
      expect(dlqCount).toBe(0);

      const waitingCount = await queue.getJobCountByTypes('waiting');
      expect(waitingCount).toBe(3);
    });

    it('should replay only jobs matching name filter', async () => {
      await addMultipleJobsToDLQ([
        { name: 'send-email', data: { a: 1 }, error: 'fail' },
        { name: 'send-email', data: { b: 2 }, error: 'fail' },
        { name: 'charge-card', data: { c: 3 }, error: 'fail' },
      ]);

      const count = await dlqQueue.replayAllDeadLetters({
        name: 'send-email',
      });
      expect(count).toBe(2);

      const dlqCount = await dlqQueue.getDeadLetterCount();
      expect(dlqCount).toBe(1);

      const remainingJobs = await dlqQueue.getDeadLetterJobs();
      expect(remainingJobs[0].name).toBe('charge-card');
    });

    it('should replay only jobs matching failedReason filter', async () => {
      await addMultipleJobsToDLQ([
        { name: 'job1', data: { a: 1 }, error: 'ETIMEDOUT' },
        { name: 'job2', data: { b: 2 }, error: 'ECONNREFUSED' },
        { name: 'job3', data: { c: 3 }, error: 'ETIMEDOUT' },
      ]);

      const count = await dlqQueue.replayAllDeadLetters({
        failedReason: 'ETIMEDOUT',
      });
      expect(count).toBe(2);

      const dlqCount = await dlqQueue.getDeadLetterCount();
      expect(dlqCount).toBe(1);
    });

    it('should purge all dead-lettered jobs', async () => {
      await addMultipleJobsToDLQ([
        { name: 'job1', data: { a: 1 }, error: 'fail1' },
        { name: 'job2', data: { b: 2 }, error: 'fail2' },
        { name: 'job3', data: { c: 3 }, error: 'fail3' },
        { name: 'job4', data: { d: 4 }, error: 'fail4' },
        { name: 'job5', data: { e: 5 }, error: 'fail5' },
      ]);

      const count = await dlqQueue.purgeDeadLetters();
      expect(count).toBe(5);

      const dlqCount = await dlqQueue.getDeadLetterCount();
      expect(dlqCount).toBe(0);
    });

    it('should purge only jobs matching filter', async () => {
      await addMultipleJobsToDLQ([
        { name: 'send-email', data: { a: 1 }, error: 'fail' },
        { name: 'send-email', data: { b: 2 }, error: 'fail' },
        { name: 'charge-card', data: { c: 3 }, error: 'fail' },
      ]);

      const count = await dlqQueue.purgeDeadLetters({ name: 'send-email' });
      expect(count).toBe(2);

      const dlqCount = await dlqQueue.getDeadLetterCount();
      expect(dlqCount).toBe(1);

      const remainingJobs = await dlqQueue.getDeadLetterJobs();
      expect(remainingJobs[0].name).toBe('charge-card');
    });

    it('should return 0 for empty DLQ', async () => {
      const dlqCount = await dlqQueue.getDeadLetterCount();
      expect(dlqCount).toBe(0);

      const replayCount = await dlqQueue.replayAllDeadLetters();
      expect(replayCount).toBe(0);

      const purgeCount = await dlqQueue.purgeDeadLetters();
      expect(purgeCount).toBe(0);
    });

    it('should handle bulk replay with multiple source queues', async () => {
      const queueName2 = `test-${v4()}`;
      const queue2 = new Queue(queueName2, { connection, prefix });

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
        queueName2,
        async () => {
          throw new Error('fail');
        },
        {
          connection,
          prefix,
          deadLetterQueue: { queueName: dlqQueueName },
        },
      );

      await worker1.waitUntilReady();
      await worker2.waitUntilReady();

      let failedCount = 0;
      const allDonePromise = new Promise<void>(resolve => {
        const onFailed = () => {
          failedCount++;
          if (failedCount >= 3) {
            resolve();
          }
        };
        worker1.on('failed', onFailed);
        worker2.on('failed', onFailed);
      });

      await queue.add('job-q1-a', { from: 'q1' }, { attempts: 1 });
      await queue.add('job-q1-b', { from: 'q1' }, { attempts: 1 });
      await queue2.add('job-q2', { from: 'q2' }, { attempts: 1 });

      await allDonePromise;
      await delay(500);

      const dlqCount = await dlqQueue.getDeadLetterCount();
      expect(dlqCount).toBe(3);

      const count = await dlqQueue.replayAllDeadLetters();
      expect(count).toBe(3);

      await delay(100);

      const q1Waiting = await queue.getJobCountByTypes('waiting');
      const q2Waiting = await queue2.getJobCountByTypes('waiting');
      expect(q1Waiting).toBe(2);
      expect(q2Waiting).toBe(1);

      await worker1.close();
      await worker2.close();
      await queue2.close();
      await removeAllQueueData(new IORedis(redisHost), queueName2);
    });
  });
});
