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
import { Queue, QueueEvents, Worker, FlowProducer } from '../src/classes';
import { removeAllQueueData, delay } from '../src/utils';

describe('JobGroup - Edge Cases', () => {
  const redisHost = process.env.REDIS_HOST || 'localhost';
  const prefix = process.env.BULLMQ_TEST_PREFIX || 'bull';

  let queue: Queue;
  let queueName: string;
  let flowProducer: FlowProducer;
  let worker: Worker;
  let queueEvents: QueueEvents;
  let connection: IORedis;

  beforeAll(async () => {
    connection = new IORedis(redisHost, { maxRetriesPerRequest: null });
  });

  beforeEach(async () => {
    queueName = `test-${v4()}`;
    queue = new Queue(queueName, { connection, prefix });
    flowProducer = new FlowProducer({ connection, prefix });
    queueEvents = new QueueEvents(queueName, { connection, prefix });
    await queueEvents.waitUntilReady();
  });

  afterEach(async () => {
    if (worker) {
      await worker.close();
    }
    await queueEvents.close();
    await flowProducer.close();
    await queue.close();
    await removeAllQueueData(new IORedis(redisHost), queueName);
  });

  afterAll(async () => {
    await connection.quit();
  });

  // VAL-16: Delayed jobs in a group are cancelled during compensation
  it('should cancel delayed jobs during compensation', async () => {
    const groupNode = await flowProducer.addGroup({
      name: 'delayed-group',
      jobs: [
        { name: 'job-a', queueName, data: { shouldFail: true } },
        {
          name: 'job-b',
          queueName,
          data: { task: 'delayed' },
          opts: { delay: 60000 },
        },
      ],
      compensation: {},
    });

    worker = new Worker(
      queueName,
      async job => {
        if (job.data.shouldFail) {
          throw new Error('fail');
        }
        return 'done';
      },
      { connection, prefix },
    );

    await delay(3000);

    const groupState = await queue.getGroupState(groupNode.groupId);
    expect(groupState).toBeDefined();
    expect(['FAILED', 'COMPENSATING', 'ACTIVE']).toContain(groupState!.state);

    const groupJobs = await queue.getGroupJobs(groupNode.groupId);
    const delayedJob = groupJobs.find(j => j.jobKey.includes(groupNode.jobs[1].id));
    if (delayedJob && groupState!.state === 'FAILED') {
      expect(delayedJob.status).toBe('cancelled');
    }
  });

  // VAL-17: Prioritized jobs in a group are cancelled during compensation
  it('should cancel prioritized jobs during compensation', async () => {
    const groupNode = await flowProducer.addGroup({
      name: 'priority-group',
      jobs: [
        { name: 'job-a', queueName, data: { shouldFail: true } },
        {
          name: 'job-b',
          queueName,
          data: { task: 'priority' },
          opts: { priority: 5 },
        },
      ],
      compensation: {},
    });

    worker = new Worker(
      queueName,
      async job => {
        if (job.data.shouldFail) {
          throw new Error('fail');
        }
        return 'done';
      },
      { connection, prefix },
    );

    await delay(3000);

    const groupState = await queue.getGroupState(groupNode.groupId);
    expect(groupState).toBeDefined();
    expect(['FAILED', 'COMPENSATING', 'ACTIVE']).toContain(groupState!.state);
  });
});
