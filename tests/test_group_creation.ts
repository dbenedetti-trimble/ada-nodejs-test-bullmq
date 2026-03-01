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

describe('JobGroup - creation', () => {
  const redisHost = process.env.REDIS_HOST || 'localhost';
  const prefix = process.env.BULLMQ_TEST_PREFIX || 'bull';

  let connection: IORedis;
  let queue: Queue;
  let queueName: string;
  let flowProducer: FlowProducer;

  beforeAll(async () => {
    connection = new IORedis(redisHost, { maxRetriesPerRequest: null });
  });

  beforeEach(async () => {
    queueName = `test-${v4()}`;
    queue = new Queue(queueName, { connection, prefix });
    flowProducer = new FlowProducer({ connection, prefix });
  });

  afterEach(async () => {
    await queue.close();
    await flowProducer.close();
    await removeAllQueueData(new IORedis(redisHost), queueName);
  });

  afterAll(async () => {
    await connection.quit();
  });

  // VAL-01: Happy path group creation
  it('addGroup returns GroupNode with groupId and Job instances; group hash is ACTIVE', async () => {
    // TODO(features): implement
  });

  // VAL-02: Empty jobs array
  it('throws when jobs array is empty without creating Redis keys', async () => {
    // TODO(features): implement
    await expect(
      flowProducer.addGroup({ name: 'test-group', jobs: [] }),
    ).rejects.toThrow('Group must contain at least one job');
  });

  // VAL-03: Mismatched compensation key
  it('throws when compensation key does not match any job name', async () => {
    // TODO(features): implement
    await expect(
      flowProducer.addGroup({
        name: 'test-group',
        jobs: [{ name: 'job-a', queueName, data: {} }],
        compensation: {
          'nonexistent-job': { name: 'compensate-a', data: {} },
        },
      }),
    ).rejects.toThrow(
      'Compensation key "nonexistent-job" does not match any job name',
    );
  });

  // VAL-18: Job with opts.parent set throws validation error
  it('throws when a job has opts.parent set', async () => {
    // TODO(features): implement
    await expect(
      flowProducer.addGroup({
        name: 'test-group',
        jobs: [
          {
            name: 'job-a',
            queueName,
            data: {},
            opts: { parent: { id: 'parent-id', queue: 'parent-queue' } },
          },
        ],
      }),
    ).rejects.toThrow('A job cannot belong to both a group and a flow');
  });

  // VAL-01 sub-check: all jobs carry opts.group.id
  it('all created jobs carry opts.group.id matching the returned groupId', async () => {
    // TODO(features): implement
  });
});
