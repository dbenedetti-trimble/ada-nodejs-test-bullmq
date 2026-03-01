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
import { FlowProducer, Queue } from '../src/classes';
import { removeAllQueueData } from '../src/utils';

describe('JobGroup - Creation (GRP-1)', () => {
  const redisHost = process.env.REDIS_HOST || 'localhost';
  const prefix = process.env.BULLMQ_TEST_PREFIX || 'bull';

  let flowProducer: FlowProducer;
  let queue: Queue;
  let queueName: string;
  let connection: IORedis;

  beforeAll(async () => {
    connection = new IORedis(redisHost, { maxRetriesPerRequest: null });
  });

  beforeEach(async () => {
    queueName = `test-${v4()}`;
    queue = new Queue(queueName, { connection, prefix });
    flowProducer = new FlowProducer({ connection, prefix });
  });

  afterEach(async () => {
    await flowProducer.close();
    await queue.close();
    await removeAllQueueData(new IORedis(redisHost), queueName);
  });

  afterAll(async () => {
    await connection.quit();
  });

  // VAL-01
  it('should create a job group atomically and return a GroupNode', async () => {
    const groupNode = await flowProducer.addGroup({
      name: 'test-group',
      jobs: [
        { name: 'job-a', queueName, data: { value: 1 } },
        { name: 'job-b', queueName, data: { value: 2 } },
      ],
    });

    expect(groupNode).toBeDefined();
    expect(groupNode.groupId).toBeTruthy();
    expect(groupNode.name).toBe('test-group');
    expect(groupNode.jobs).toHaveLength(2);
    expect(groupNode.jobs[0].name).toBe('job-a');
    expect(groupNode.jobs[1].name).toBe('job-b');

    const state = await queue.getGroupState(groupNode.groupId);
    expect(state).not.toBeNull();
    expect(state!.state).toBe('ACTIVE');
    expect(state!.totalJobs).toBe(2);
    expect(state!.completedCount).toBe(0);
  });

  // VAL-02
  it('should throw an error when jobs array is empty', async () => {
    await expect(
      flowProducer.addGroup({
        name: 'empty-group',
        jobs: [],
      }),
    ).rejects.toThrow('at least one job');
  });

  // VAL-03
  it('should throw an error when compensation references an unknown job name', async () => {
    await expect(
      flowProducer.addGroup({
        name: 'bad-compensation-group',
        jobs: [{ name: 'job-a', queueName, data: {} }],
        compensation: {
          'nonexistent-job': { name: 'compensate-nonexistent' },
        },
      }),
    ).rejects.toThrow('does not match any job name');
  });

  // VAL-18
  it('should throw an error when a job has both opts.parent and group membership', async () => {
    await expect(
      flowProducer.addGroup({
        name: 'parent-conflict-group',
        jobs: [
          {
            name: 'job-a',
            queueName,
            data: {},
            opts: {
              parent: { id: 'parent-id', queue: `${prefix}:${queueName}` },
            },
          },
        ],
      }),
    ).rejects.toThrow('must not have opts.parent');
  });

  it('should store compensation mapping in group metadata', async () => {
    const groupNode = await flowProducer.addGroup({
      name: 'comp-group',
      jobs: [{ name: 'job-a', queueName, data: {} }],
      compensation: {
        'job-a': { name: 'compensate-job-a', data: { rollback: true } },
      },
    });

    const prefix2 = prefix;
    const groupHashKey = `${prefix2}:${queueName}:groups:${groupNode.groupId}`;
    const raw = await connection.hget(groupHashKey, 'compensation');
    const mapping = JSON.parse(raw!);
    expect(mapping['job-a']).toBeDefined();
    expect(mapping['job-a'].name).toBe('compensate-job-a');
  });

  it('should inject group.id into each member job opts', async () => {
    const groupNode = await flowProducer.addGroup({
      name: 'opts-group',
      jobs: [{ name: 'job-a', queueName, data: {} }],
    });

    const job = groupNode.jobs[0];
    expect(job.opts.group).toBeDefined();
    expect(job.opts.group!.id).toBe(groupNode.groupId);
  });

  it('should support jobs targeting different queue names', async () => {
    const queueName2 = `test-${v4()}`;
    const queue2 = new Queue(queueName2, { connection, prefix });

    try {
      const groupNode = await flowProducer.addGroup({
        name: 'cross-queue-group',
        jobs: [
          { name: 'job-a', queueName, data: {} },
          { name: 'job-b', queueName: queueName2, data: {} },
        ],
      });

      expect(groupNode.jobs).toHaveLength(2);
      const jobs = await queue.getGroupJobs(groupNode.groupId);
      expect(jobs.length).toBeGreaterThanOrEqual(1);
    } finally {
      await queue2.close();
      await removeAllQueueData(new IORedis(redisHost), queueName2);
    }
  });
});
