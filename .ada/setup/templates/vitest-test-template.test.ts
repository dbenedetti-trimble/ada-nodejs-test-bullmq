/**
 * BullMQ Basic Test Template
 *
 * Test Quality Principles:
 * - Test behavior, not implementation
 * - Validate acceptance criteria explicitly
 * - Minimize mocking; never mock Redis or business logic
 * - Cover both positive and negative cases
 * - Avoid coverage theater; focus on meaningful assertions
 *
 * Anti-Patterns to Avoid:
 * - Mocking Redis client or internal BullMQ classes
 * - Testing internal Redis key structures directly
 * - Tests not tied to acceptance criteria
 * - Flaky timing-dependent tests (use Promise-based resolution)
 * - Not cleaning up Workers/Queues in afterEach
 *
 * Real Dependencies vs Mocks:
 * - Real: Redis, Queue, Worker, Job, QueueEvents, Lua scripts
 * - Mock: External HTTP APIs, file system, third-party services
 * - Consider: Sinon stubs for verification of callback behavior
 *
 * Execution: yarn test (runs pretest + vitest)
 *            yarn test:watch (watch mode)
 *            npx vitest tests/<file>.test.ts (single file)
 */

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
import { Queue, Worker, Job } from '../src/classes';
import { removeAllQueueData, delay } from '../src/utils';

describe('[FEATURE_NAME]', () => {
  const redisHost = process.env.REDIS_HOST || 'localhost';
  const prefix = process.env.BULLMQ_TEST_PREFIX || 'bull';

  let queue: Queue;
  let queueName: string;

  let connection: IORedis;
  beforeAll(async () => {
    connection = new IORedis(redisHost, { maxRetriesPerRequest: null });
  });

  beforeEach(async () => {
    queueName = `test-${v4()}`;
    queue = new Queue(queueName, { connection, prefix });
  });

  afterEach(async () => {
    await queue.close();
    await removeAllQueueData(new IORedis(redisHost), queueName);
  });

  afterAll(async () => {
    await connection.quit();
  });

  it('should [POSITIVE_CASE_DESCRIPTION]', async () => {
    // Arrange: Add a job to the queue
    const job = await queue.add('test', { foo: 'bar' });

    // Act: Retrieve the job
    const fetchedJob = await Job.fromId(queue, job.id!);

    // Assert: Verify job properties
    expect(fetchedJob).toBeTruthy();
    expect(fetchedJob!.data.foo).toBe('bar');
    expect(fetchedJob!.name).toBe('test');
  });

  it('should [NEGATIVE_CASE_DESCRIPTION]', async () => {
    // Arrange & Act: Try to fetch a non-existent job
    const fetchedJob = await Job.fromId(queue, 'non-existent-id');

    // Assert: Job should not exist
    expect(fetchedJob).toBeUndefined();
  });

  it('should process jobs end-to-end', async () => {
    // Arrange: Create a worker with a processor
    let processor;
    const processing = new Promise<void>(
      resolve =>
        (processor = async (job: Job) => {
          expect(job.data.value).toBe(42);
          resolve();
        }),
    );

    const worker = new Worker(queueName, processor, { connection, prefix });
    await worker.waitUntilReady();

    // Act: Add a job
    await queue.add('test', { value: 42 });

    // Assert: Wait for processing to complete
    await processing;

    await worker.close();
  });

  describe('[EDGE_CASE_GROUP]', () => {
    it('should handle empty data', async () => {
      const job = await queue.add('test', {});
      const fetchedJob = await Job.fromId(queue, job.id!);

      expect(fetchedJob).toBeTruthy();
      expect(fetchedJob!.data).toEqual({});
    });

    it('should handle large payloads', async () => {
      const largeData = { items: Array.from({ length: 1000 }, (_, i) => ({ id: i })) };
      const job = await queue.add('test', largeData);
      const fetchedJob = await Job.fromId(queue, job.id!);

      expect(fetchedJob!.data.items).toHaveLength(1000);
    });
  });
});
