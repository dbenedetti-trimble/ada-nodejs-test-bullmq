/**
 * BullMQ Redis Cluster Integration Test Template
 *
 * Tests for BullMQ operations running against a Redis Cluster.
 * Cluster mode requires a different connection setup and tests
 * should validate that BullMQ operations work correctly with
 * Redis key distribution across multiple nodes.
 *
 * Prerequisites:
 *   docker-compose --profile cluster up -d
 *
 * Key patterns:
 * - Use IORedis.Cluster for cluster connections
 * - Cluster tests may need longer timeouts
 * - Key slot distribution affects certain operations
 * - Use \{queueName\} hash tags to ensure keys land on same slot
 *
 * Execution: yarn test (runs pretest + vitest)
 *            npx vitest tests/<file>.test.ts (single file)
 */

import { default as IORedis, Cluster } from 'ioredis';
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
import { Queue, Worker, Job, QueueEvents } from '../src/classes';
import { removeAllQueueData, delay } from '../src/utils';

describe('[FEATURE_NAME] - Redis Cluster', () => {
  const redisHost = process.env.REDIS_HOST || 'localhost';
  const prefix = process.env.BULLMQ_TEST_PREFIX || 'bull';

  let queue: Queue;
  let queueName: string;
  let cluster: Cluster;

  beforeAll(async () => {
    cluster = new IORedis.Cluster(
      [{ host: redisHost, port: 7380 }],
      {
        natMap: {
          '172.33.0.2:6380': { host: redisHost, port: 7380 },
          '172.33.0.3:6381': { host: redisHost, port: 7381 },
          '172.33.0.4:6382': { host: redisHost, port: 7382 },
          '172.33.0.5:6383': { host: redisHost, port: 7383 },
          '172.33.0.6:6384': { host: redisHost, port: 7384 },
          '172.33.0.7:6385': { host: redisHost, port: 7385 },
        },
      },
    );
    await cluster.ping();
  });

  beforeEach(async () => {
    queueName = `test-${v4()}`;
    queue = new Queue(queueName, { connection: cluster, prefix });
  });

  afterEach(async () => {
    await queue.close();
  });

  afterAll(async () => {
    await cluster.quit();
  });

  describe('basic cluster operations', () => {
    it('should add and retrieve jobs in cluster mode', async () => {
      const job = await queue.add('test', { foo: 'bar' });

      expect(job.id).toBeTruthy();

      const fetchedJob = await Job.fromId(queue, job.id!);
      expect(fetchedJob).toBeTruthy();
      expect(fetchedJob!.data.foo).toBe('bar');
    });

    it('should process jobs with a worker in cluster mode', async () => {
      let processor;
      const processing = new Promise<void>(
        resolve =>
          (processor = async (job: Job) => {
            expect(job.data.value).toBe(42);
            resolve();
          }),
      );

      const worker = new Worker(queueName, processor, {
        connection: cluster,
        prefix,
      });
      await worker.waitUntilReady();

      await queue.add('test', { value: 42 });
      await processing;

      await worker.close();
    });
  });

  describe('cluster-specific behavior', () => {
    it('should handle bulk operations across cluster nodes', async () => {
      const jobs = await queue.addBulk(
        Array.from({ length: 10 }, (_, i) => ({
          name: `job-${i}`,
          data: { index: i },
        })),
      );

      expect(jobs).toHaveLength(10);

      const counts = await queue.getJobCounts('waiting');
      expect(counts.waiting).toBe(10);
    });

    it('should emit events in cluster mode', async () => {
      const queueEvents = new QueueEvents(queueName, {
        connection: cluster,
        prefix,
      });
      await queueEvents.waitUntilReady();

      const completed = new Promise<string>((resolve) => {
        queueEvents.on('completed', ({ jobId }) => {
          resolve(jobId);
        });
      });

      const worker = new Worker(
        queueName,
        async () => 'done',
        { connection: cluster, prefix },
      );
      await worker.waitUntilReady();

      const job = await queue.add('test', { data: 'test' });
      const completedJobId = await completed;

      expect(completedJobId).toBe(job.id);

      await worker.close();
      await queueEvents.close();
    });
  });
});
