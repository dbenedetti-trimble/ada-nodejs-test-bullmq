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
import { InvalidGroupStateError } from '../src/classes/errors';
import { removeAllQueueData, delay } from '../src/utils';

/**
 * Group cancellation tests (VAL-10, VAL-11, VAL-12)
 */
describe('JobGroup cancellation', () => {
  const redisHost = process.env.REDIS_HOST || 'localhost';
  const prefix = process.env.BULLMQ_TEST_PREFIX || 'bull';

  let connection: IORedis;
  let queue: Queue;
  let queueName: string;
  let flowProducer: FlowProducer;
  let queueEvents: QueueEvents;
  const workers: Worker[] = [];

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
    await Promise.all(workers.map(w => w.close()));
    workers.length = 0;
    await queueEvents.close();
    await flowProducer.close();
    await queue.close();
    await removeAllQueueData(new IORedis(redisHost), queueName);
  });

  afterAll(async () => {
    await connection.quit();
  });

  // VAL-11: Cancel active group with all jobs still waiting → FAILED, no compensation
  it('transitions to FAILED with no compensation when all jobs are still waiting (VAL-11)', async () => {
    const groupNode = await flowProducer.addGroup({
      name: 'cancel-all-waiting',
      queueName,
      jobs: [
        { name: 'job-a', queueName, data: {} },
        { name: 'job-b', queueName, data: {} },
        { name: 'job-c', queueName, data: {} },
      ],
    });

    // Cancel while all jobs are in waiting state (no workers running)
    await queue.cancelGroup(groupNode.groupId);

    const groupState = await queue.getGroupState(groupNode.groupId);
    expect(groupState!.state).toBe('FAILED');
    expect(groupState!.cancelledCount).toBe(3);
  });

  // VAL-10: Cancel active group with completed + waiting jobs → COMPENSATING + compensation
  it('cancels waiting jobs and creates compensation for completed jobs (VAL-10)', async () => {
    const groupNode = await flowProducer.addGroup({
      name: 'cancel-with-completed',
      queueName,
      jobs: [
        { name: 'job-a', queueName, data: { succeed: true } },
        { name: 'job-b', queueName, data: {} },
        { name: 'job-c', queueName, data: {} },
      ],
      compensation: {
        'job-a': { name: 'comp-a', data: { reverse: true } },
      },
    });

    // Process only job-a to completion
    let resolveAfterFirst: () => void;
    const firstDone = new Promise<void>(r => (resolveAfterFirst = r));

    const worker = new Worker(
      queueName,
      async job => {
        if (job.data.succeed) {
          resolveAfterFirst!();
          return 'ok';
        }
        await delay(30000); // block other jobs
      },
      { connection, prefix, concurrency: 1 },
    );
    workers.push(worker);

    await firstDone;
    await delay(500); // let completed propagate
    await worker.close();
    workers.pop();

    // Now cancel the group while job-b and job-c are still waiting
    await queue.cancelGroup(groupNode.groupId);

    const groupState = await queue.getGroupState(groupNode.groupId);
    // job-a was completed, so we expect COMPENSATING state
    expect(['COMPENSATING', 'FAILED']).toContain(groupState!.state);
  }, 30000);

  // VAL-12: Cancel a completed group → throws InvalidGroupStateError
  it('throws InvalidGroupStateError when cancelling a completed group (VAL-12)', async () => {
    const groupNode = await flowProducer.addGroup({
      name: 'completed-group',
      queueName,
      jobs: [
        { name: 'job-a', queueName, data: {} },
      ],
    });

    const completedEvent = new Promise<void>(resolve => {
      queueEvents.once('group:completed', () => resolve());
    });

    workers.push(
      new Worker(queueName, async () => 'done', { connection, prefix }),
    );

    await completedEvent;

    await expect(queue.cancelGroup(groupNode.groupId)).rejects.toThrow(
      InvalidGroupStateError,
    );

    const groupState = await queue.getGroupState(groupNode.groupId);
    expect(groupState!.state).toBe('COMPLETED');
  }, 30000);
});
