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
import { FlowProducer, Queue, Worker, QueueEvents } from '../src/classes';
import { removeAllQueueData } from '../src/utils';

describe('JobGroup - Successful Completion (GRP-3)', () => {
  const redisHost = process.env.REDIS_HOST || 'localhost';
  const prefix = process.env.BULLMQ_TEST_PREFIX || 'bull';

  let flowProducer: FlowProducer;
  let queue: Queue;
  let worker: Worker;
  let queueEvents: QueueEvents;
  let queueName: string;
  let connection: IORedis;

  beforeAll(async () => {
    connection = new IORedis(redisHost, { maxRetriesPerRequest: null });
  });

  beforeEach(async () => {
    queueName = `test-${v4()}`;
    queue = new Queue(queueName, { connection, prefix });
    queueEvents = new QueueEvents(queueName, { connection, prefix });
    flowProducer = new FlowProducer({ connection, prefix });
    await queueEvents.waitUntilReady();
  });

  afterEach(async () => {
    await worker?.close();
    await flowProducer.close();
    await queueEvents.close();
    await queue.close();
    await removeAllQueueData(new IORedis(redisHost), queueName);
  });

  afterAll(async () => {
    await connection.quit();
  });

  // VAL-04
  it('should transition group to COMPLETED when all jobs succeed', async () => {
    const groupNode = await flowProducer.addGroup({
      name: 'complete-group',
      jobs: [
        { name: 'job-a', queueName, data: {} },
        { name: 'job-b', queueName, data: {} },
      ],
    });

    let processedCount = 0;
    worker = new Worker(
      queueName,
      async () => {
        processedCount++;
        return { done: true };
      },
      { connection, prefix },
    );

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('timeout waiting for completion')),
        10000,
      );
      worker.on('completed', async () => {
        if (processedCount >= 2) {
          clearTimeout(timeout);
          resolve();
        }
      });
    });

    // Allow the group hook to propagate
    await new Promise(r => setTimeout(r, 500));

    const state = await queue.getGroupState(groupNode.groupId);
    expect(state!.state).toBe('COMPLETED');
    expect(state!.completedCount).toBe(2);
  });

  // VAL-05
  it('should emit group:completed exactly once even with concurrent workers', async () => {
    const groupNode = await flowProducer.addGroup({
      name: 'concurrent-complete-group',
      jobs: [
        { name: 'job-a', queueName, data: {} },
        { name: 'job-b', queueName, data: {} },
      ],
    });

    const completedEvents: string[] = [];

    const worker2 = new Worker(
      queueName,
      async () => ({ result: 'ok' }),
      { connection: new IORedis(redisHost, { maxRetriesPerRequest: null }), prefix },
    );
    worker = new Worker(
      queueName,
      async () => ({ result: 'ok' }),
      { connection: new IORedis(redisHost, { maxRetriesPerRequest: null }), prefix },
    );

    await new Promise<void>((resolve, reject) => {
      let completed = 0;
      const timeout = setTimeout(
        () => reject(new Error('timeout')),
        10000,
      );
      const onCompleted = () => {
        completed++;
        if (completed >= 2) {
          clearTimeout(timeout);
          resolve();
        }
      };
      worker.on('completed', onCompleted);
      worker2.on('completed', onCompleted);
    });

    await new Promise(r => setTimeout(r, 500));
    await worker2.close();

    const state = await queue.getGroupState(groupNode.groupId);
    expect(state!.state).toBe('COMPLETED');

    const prefix2 = prefix;
    const eventsKey = `${prefix2}:${queueName}:events`;
    const events = await connection.xrange(eventsKey, '-', '+');
    const groupCompletedEvents = events.filter(([, fields]) => {
      const idx = fields.indexOf('event');
      return idx >= 0 && fields[idx + 1] === 'group:completed';
    });
    expect(groupCompletedEvents.length).toBe(1);
  });

  it('should set completedCount equal to totalJobs on completion', async () => {
    const groupNode = await flowProducer.addGroup({
      name: 'count-group',
      jobs: [
        { name: 'job-a', queueName, data: {} },
        { name: 'job-b', queueName, data: {} },
        { name: 'job-c', queueName, data: {} },
      ],
    });

    let processed = 0;
    worker = new Worker(queueName, async () => {
      processed++;
    }, { connection, prefix });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('timeout')), 15000);
      worker.on('completed', () => {
        if (processed >= 3) {
          clearTimeout(timeout);
          resolve();
        }
      });
    });

    await new Promise(r => setTimeout(r, 500));

    const state = await queue.getGroupState(groupNode.groupId);
    expect(state!.completedCount).toBe(state!.totalJobs);
  });

  it('should emit group:completed event with groupId and groupName', async () => {
    const groupNode = await flowProducer.addGroup({
      name: 'event-group',
      jobs: [{ name: 'job-a', queueName, data: {} }],
    });

    worker = new Worker(queueName, async () => 'done', { connection, prefix });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('timeout')), 10000);
      worker.on('completed', () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    await new Promise(r => setTimeout(r, 500));

    const eventsKey = `${prefix}:${queueName}:events`;
    const events = await connection.xrange(eventsKey, '-', '+');
    const groupCompleted = events.find(([, fields]) => {
      const idx = fields.indexOf('event');
      return idx >= 0 && fields[idx + 1] === 'group:completed';
    });

    expect(groupCompleted).toBeDefined();
    const fields = groupCompleted![1];
    const groupIdIdx = fields.indexOf('groupId');
    expect(fields[groupIdIdx + 1]).toBe(groupNode.groupId);
    const groupNameIdx = fields.indexOf('groupName');
    expect(fields[groupNameIdx + 1]).toBe('event-group');
  });
});
