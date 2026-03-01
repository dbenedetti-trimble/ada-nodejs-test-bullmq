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
import { Queue, QueueEvents, Worker } from '../src/classes';
import { delay, removeAllQueueData } from '../src/utils';
import { CircuitBreaker } from '../src/classes/circuit-breaker';
import { CircuitBreakerState } from '../src/enums/circuit-breaker-state';

// ---------------------------------------------------------------------------
// Integration tests for circuit breaker state machine, events, and lifecycle.
// Uses real Queue + Worker + Redis with short durations (100-300 ms) to
// avoid flakiness.
// ---------------------------------------------------------------------------

const TEST_TIMEOUT = 15000;

describe('Circuit breaker', () => {
  const redisHost = process.env.REDIS_HOST || 'localhost';
  const prefix = process.env.BULLMQ_TEST_PREFIX || 'bull';

  let queue: Queue;
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
    await queueEvents.waitUntilReady();
  });

  afterEach(async () => {
    await queue.close();
    await queueEvents.close();
    await removeAllQueueData(new IORedis(redisHost), queueName);
  });

  afterAll(async () => {
    await connection.quit();
  });

  // ---------------------------------------------------------------------------
  // Unit-level tests for CircuitBreaker class (no Redis needed)
  // ---------------------------------------------------------------------------

  describe('CircuitBreaker unit tests', () => {
    it('starts in CLOSED state', () => {
      const cb = new CircuitBreaker(
        { threshold: 3, duration: 100, halfOpenMaxAttempts: 1 },
        () => {},
      );
      expect(cb.getState()).toBe(CircuitBreakerState.CLOSED);
    });

    it('transitions CLOSED → OPEN after threshold failures', () => {
      const transitions: any[] = [];
      const cb = new CircuitBreaker(
        { threshold: 3, duration: 10000, halfOpenMaxAttempts: 1 },
        payload => transitions.push(payload),
      );

      cb.recordFailure();
      expect(cb.getState()).toBe(CircuitBreakerState.CLOSED);
      cb.recordFailure();
      expect(cb.getState()).toBe(CircuitBreakerState.CLOSED);
      cb.recordFailure();
      expect(cb.getState()).toBe(CircuitBreakerState.OPEN);

      expect(transitions).toHaveLength(1);
      expect(transitions[0].state).toBe(CircuitBreakerState.OPEN);
      expect(transitions[0].failures).toBe(3);
      expect(transitions[0].threshold).toBe(3);

      cb.close();
    });

    it('shouldAllowJob returns false when OPEN', () => {
      const cb = new CircuitBreaker(
        { threshold: 1, duration: 10000, halfOpenMaxAttempts: 1 },
        () => {},
      );
      cb.recordFailure();
      expect(cb.getState()).toBe(CircuitBreakerState.OPEN);
      expect(cb.shouldAllowJob()).toBe(false);
      cb.close();
    });

    it('success in CLOSED state resets failure counter', () => {
      const cb = new CircuitBreaker(
        { threshold: 3, duration: 10000, halfOpenMaxAttempts: 1 },
        () => {},
      );
      cb.recordFailure();
      cb.recordFailure();
      cb.recordSuccess('job-1');
      // Counter reset — two more failures should not trip
      cb.recordFailure();
      cb.recordFailure();
      expect(cb.getState()).toBe(CircuitBreakerState.CLOSED);
    });

    it('transitions OPEN → HALF_OPEN after duration elapses', async () => {
      const transitions: any[] = [];
      const cb = new CircuitBreaker(
        { threshold: 1, duration: 100, halfOpenMaxAttempts: 1 },
        payload => transitions.push(payload),
      );
      cb.recordFailure();
      expect(cb.getState()).toBe(CircuitBreakerState.OPEN);

      await delay(200);
      expect(cb.getState()).toBe(CircuitBreakerState.HALF_OPEN);
      const halfOpenPayload = transitions.find(
        t => t.state === CircuitBreakerState.HALF_OPEN,
      );
      expect(halfOpenPayload).toBeDefined();
      expect(halfOpenPayload.duration).toBe(100);
      cb.close();
    });

    it('shouldAllowJob allows up to halfOpenMaxAttempts in HALF_OPEN', async () => {
      const cb = new CircuitBreaker(
        { threshold: 1, duration: 100, halfOpenMaxAttempts: 2 },
        () => {},
      );
      cb.recordFailure();
      await delay(200);
      expect(cb.getState()).toBe(CircuitBreakerState.HALF_OPEN);
      expect(cb.shouldAllowJob()).toBe(true);
      cb.consumeHalfOpenAttempt();
      expect(cb.shouldAllowJob()).toBe(true);
      cb.consumeHalfOpenAttempt();
      expect(cb.shouldAllowJob()).toBe(false);
      cb.close();
    });

    it('transitions HALF_OPEN → CLOSED on recordSuccess', async () => {
      const transitions: any[] = [];
      const cb = new CircuitBreaker(
        { threshold: 1, duration: 100, halfOpenMaxAttempts: 1 },
        payload => transitions.push(payload),
      );
      cb.recordFailure();
      await delay(200);
      expect(cb.getState()).toBe(CircuitBreakerState.HALF_OPEN);

      cb.recordSuccess('test-job-id');
      expect(cb.getState()).toBe(CircuitBreakerState.CLOSED);

      const closedPayload = transitions.find(
        t => t.state === CircuitBreakerState.CLOSED,
      );
      expect(closedPayload).toBeDefined();
      expect(closedPayload.testJobId).toBe('test-job-id');
    });

    it('transitions HALF_OPEN → OPEN on recordFailure and restarts timer', async () => {
      const transitions: any[] = [];
      const cb = new CircuitBreaker(
        { threshold: 1, duration: 100, halfOpenMaxAttempts: 1 },
        payload => transitions.push(payload),
      );
      cb.recordFailure();
      await delay(200);
      expect(cb.getState()).toBe(CircuitBreakerState.HALF_OPEN);

      cb.recordFailure();
      expect(cb.getState()).toBe(CircuitBreakerState.OPEN);

      // Wait for duration timer to fire again
      await delay(200);
      expect(cb.getState()).toBe(CircuitBreakerState.HALF_OPEN);
      cb.close();
    });

    it('close() clears the duration timer', async () => {
      const transitions: any[] = [];
      const cb = new CircuitBreaker(
        { threshold: 1, duration: 200, halfOpenMaxAttempts: 1 },
        payload => transitions.push(payload),
      );
      cb.recordFailure();
      expect(cb.getState()).toBe(CircuitBreakerState.OPEN);
      cb.close();

      // After close(), the timer should not fire
      await delay(400);
      expect(cb.getState()).toBe(CircuitBreakerState.OPEN);
      const halfOpenTransitions = transitions.filter(
        t => t.state === CircuitBreakerState.HALF_OPEN,
      );
      expect(halfOpenTransitions).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // CB-1: Configuration
  // ---------------------------------------------------------------------------

  describe('configuration (CB-1)', () => {
    it('accepts circuitBreaker option on Worker construction', async () => {
      const worker = new Worker(queueName, async () => {}, {
        connection,
        prefix,
        circuitBreaker: { threshold: 3, duration: 5000 },
        autorun: false,
      });
      expect(worker.getCircuitBreakerState()).toBe('closed');
      await worker.close();
    });

    it('throws on negative threshold', () => {
      expect(
        () =>
          new Worker(queueName, async () => {}, {
            connection,
            prefix,
            circuitBreaker: { threshold: -1, duration: 5000 },
            autorun: false,
          }),
      ).toThrow(/threshold/i);
    });

    it('throws on negative duration', () => {
      expect(
        () =>
          new Worker(queueName, async () => {}, {
            connection,
            prefix,
            circuitBreaker: { threshold: 3, duration: -1 },
            autorun: false,
          }),
      ).toThrow(/duration/i);
    });

    it('throws on non-integer threshold', () => {
      expect(
        () =>
          new Worker(queueName, async () => {}, {
            connection,
            prefix,
            circuitBreaker: { threshold: 1.5, duration: 5000 },
            autorun: false,
          }),
      ).toThrow(/threshold/i);
    });

    it('throws when halfOpenMaxAttempts is not a positive integer', () => {
      expect(
        () =>
          new Worker(queueName, async () => {}, {
            connection,
            prefix,
            circuitBreaker: {
              threshold: 3,
              duration: 1000,
              halfOpenMaxAttempts: -1,
            },
            autorun: false,
          }),
      ).toThrow(
        'circuitBreaker.halfOpenMaxAttempts must be a positive integer',
      );
    });

    it('throws when halfOpenMaxAttempts is a decimal', () => {
      expect(
        () =>
          new Worker(queueName, async () => {}, {
            connection,
            prefix,
            circuitBreaker: {
              threshold: 3,
              duration: 1000,
              halfOpenMaxAttempts: 1.5,
            },
            autorun: false,
          }),
      ).toThrow(
        'circuitBreaker.halfOpenMaxAttempts must be a positive integer',
      );
    });

    it('omitting circuitBreaker produces identical behavior to current BullMQ', async () => {
      const worker = new Worker(queueName, async () => {}, {
        connection,
        prefix,
        autorun: false,
      });
      expect(worker.getCircuitBreakerState()).toBeUndefined();
      await worker.close();
    });
  });

  // VAL-16: getCircuitBreakerState() returns undefined when not configured
  describe('no circuitBreaker option (VAL-16)', () => {
    it('getCircuitBreakerState() returns undefined', async () => {
      const worker = new Worker(queueName, async () => {}, {
        connection,
        prefix,
        autorun: false,
      });
      expect(worker.getCircuitBreakerState()).toBeUndefined();
      await worker.close();
    });
  });

  // ---------------------------------------------------------------------------
  // CB-2 / VAL-11: Opens after threshold failures
  // ---------------------------------------------------------------------------

  describe('CLOSED → OPEN transition (VAL-11)', () => {
    it(
      'getCircuitBreakerState() returns "open" after threshold consecutive failures',
      async () => {
        const threshold = 3;
        let failCount = 0;

        const worker = new Worker(
          queueName,
          async () => {
            failCount++;
            throw new Error('deliberate failure');
          },
          {
            connection,
            prefix,
            circuitBreaker: { threshold, duration: 10000 },
            autorun: true,
          },
        );

        await worker.waitUntilReady();

        // Add threshold jobs (no retry so each counts as one failure)
        for (let i = 0; i < threshold; i++) {
          await queue.add('job', {}, { attempts: 1 });
        }

        // Wait until circuit opens
        await new Promise<void>(resolve => {
          worker.on('circuit:open', () => resolve());
        });

        expect(worker.getCircuitBreakerState()).toBe('open');
        await worker.close();
      },
      TEST_TIMEOUT,
    );

    it(
      'emits circuit:open event with { failures, threshold } payload (VAL-11)',
      async () => {
        const threshold = 2;

        const worker = new Worker(
          queueName,
          async () => {
            throw new Error('deliberate failure');
          },
          {
            connection,
            prefix,
            circuitBreaker: { threshold, duration: 10000 },
            autorun: true,
          },
        );

        await worker.waitUntilReady();

        let openPayload: { failures: number; threshold: number } | undefined;
        const openPromise = new Promise<void>(resolve => {
          worker.on('circuit:open', payload => {
            openPayload = payload;
            resolve();
          });
        });

        for (let i = 0; i < threshold; i++) {
          await queue.add('job', {}, { attempts: 1 });
        }

        await openPromise;

        expect(openPayload).toBeDefined();
        expect(openPayload!.failures).toBe(threshold);
        expect(openPayload!.threshold).toBe(threshold);

        await worker.close();
      },
      TEST_TIMEOUT,
    );

    it(
      'worker stops fetching new jobs while OPEN',
      async () => {
        const threshold = 1;
        let processedCount = 0;

        const worker = new Worker(
          queueName,
          async () => {
            processedCount++;
            throw new Error('fail');
          },
          {
            connection,
            prefix,
            circuitBreaker: { threshold, duration: 5000 },
            drainDelay: 1,
            autorun: true,
          },
        );

        await worker.waitUntilReady();

        // Wait for circuit to open
        const openPromise = new Promise<void>(resolve => {
          worker.on('circuit:open', () => resolve());
        });

        await queue.add('trigger', {}, { attempts: 1 });
        await openPromise;

        // Add more jobs — they should NOT be processed while circuit is OPEN
        await queue.add('should-not-run', {}, { attempts: 1 });
        await queue.add('should-not-run-2', {}, { attempts: 1 });

        const countBefore = processedCount;
        await delay(300);
        // No new jobs processed
        expect(processedCount).toBe(countBefore);

        await worker.close();
      },
      TEST_TIMEOUT,
    );
  });

  // CB-2 / VAL-15: Success resets failure counter
  describe('failure counter reset on success (VAL-15)', () => {
    it(
      'success in CLOSED state resets failure counter to 0',
      async () => {
        const threshold = 3;
        let attempt = 0;

        const worker = new Worker(
          queueName,
          async () => {
            attempt++;
            // Fail first 2 jobs, succeed the 3rd
            if (attempt <= 2) {
              throw new Error('fail');
            }
          },
          {
            connection,
            prefix,
            circuitBreaker: { threshold, duration: 10000 },
            autorun: true,
          },
        );

        await worker.waitUntilReady();

        const openEvents: number[] = [];
        worker.on('circuit:open', () => openEvents.push(Date.now()));

        // Add 3 jobs - first two fail (counter=2), third succeeds (counter reset to 0)
        for (let i = 0; i < 3; i++) {
          await queue.add('job', {}, { attempts: 1 });
        }

        // Give time for all jobs to be processed
        await delay(1000);

        // Circuit should still be closed (counter was reset on success)
        expect(worker.getCircuitBreakerState()).toBe('closed');
        expect(openEvents).toHaveLength(0);

        await worker.close();
      },
      TEST_TIMEOUT,
    );

    it(
      'circuit remains CLOSED after reset',
      async () => {
        const threshold = 3;

        const worker = new Worker(
          queueName,
          async job => {
            if (job.data.fail) {
              throw new Error('fail');
            }
          },
          {
            connection,
            prefix,
            circuitBreaker: { threshold, duration: 10000 },
            autorun: true,
          },
        );

        await worker.waitUntilReady();

        // 2 failures, then 1 success, then 2 more failures - circuit should stay CLOSED
        await queue.add('job1', { fail: true }, { attempts: 1 });
        await queue.add('job2', { fail: true }, { attempts: 1 });
        await queue.add('job3', { fail: false }, { attempts: 1 });
        await queue.add('job4', { fail: true }, { attempts: 1 });
        await queue.add('job5', { fail: true }, { attempts: 1 });

        await delay(1000);

        expect(worker.getCircuitBreakerState()).toBe('closed');

        await worker.close();
      },
      TEST_TIMEOUT,
    );

    it(
      'subsequent failures start counting from 0 after reset',
      async () => {
        const threshold = 3;

        const worker = new Worker(
          queueName,
          async job => {
            if (job.data.fail) {
              throw new Error('fail');
            }
          },
          {
            connection,
            prefix,
            circuitBreaker: { threshold, duration: 10000 },
            autorun: true,
          },
        );

        await worker.waitUntilReady();

        const openEvents: number[] = [];
        worker.on('circuit:open', () => openEvents.push(Date.now()));

        // 2 failures, 1 success (reset), then 2 more failures → counter should be 2, not 4
        await queue.add('f1', { fail: true }, { attempts: 1 });
        await queue.add('f2', { fail: true }, { attempts: 1 });
        await queue.add('s1', { fail: false }, { attempts: 1 });
        await queue.add('f3', { fail: true }, { attempts: 1 });
        await queue.add('f4', { fail: true }, { attempts: 1 });

        await delay(1000);

        // With threshold=3, after reset counter is at 2 — no open
        expect(openEvents).toHaveLength(0);

        await worker.close();
      },
      TEST_TIMEOUT,
    );
  });

  // CB-2 / VAL-12: OPEN → HALF_OPEN after duration
  describe('OPEN → HALF_OPEN transition (VAL-12)', () => {
    it(
      'getCircuitBreakerState() returns "half-open" after duration elapses',
      async () => {
        const worker = new Worker(
          queueName,
          async () => {
            throw new Error('fail');
          },
          {
            connection,
            prefix,
            circuitBreaker: { threshold: 1, duration: 200 },
            autorun: true,
          },
        );

        await worker.waitUntilReady();

        await queue.add('job', {}, { attempts: 1 });

        // Wait for circuit to open
        await new Promise<void>(resolve => worker.on('circuit:open', resolve));
        expect(worker.getCircuitBreakerState()).toBe('open');

        // Wait for duration + buffer
        await new Promise<void>(resolve =>
          worker.on('circuit:half-open', resolve),
        );
        expect(worker.getCircuitBreakerState()).toBe('half-open');

        await worker.close();
      },
      TEST_TIMEOUT,
    );

    it(
      'emits circuit:half-open event with { duration } payload (VAL-12)',
      async () => {
        const duration = 200;
        const worker = new Worker(
          queueName,
          async () => {
            throw new Error('fail');
          },
          {
            connection,
            prefix,
            circuitBreaker: { threshold: 1, duration },
            autorun: true,
          },
        );

        await worker.waitUntilReady();
        await queue.add('job', {}, { attempts: 1 });

        await new Promise<void>(resolve => worker.on('circuit:open', resolve));

        let halfOpenPayload: { duration: number } | undefined;
        const halfOpenPromise = new Promise<void>(resolve => {
          worker.on('circuit:half-open', payload => {
            halfOpenPayload = payload;
            resolve();
          });
        });

        await halfOpenPromise;
        expect(halfOpenPayload).toBeDefined();
        expect(halfOpenPayload!.duration).toBe(duration);

        await worker.close();
      },
      TEST_TIMEOUT,
    );
  });

  // CB-2 / VAL-13: HALF_OPEN → CLOSED on successful test job
  describe('HALF_OPEN → CLOSED transition (VAL-13)', () => {
    it(
      'getCircuitBreakerState() returns "closed" after test job succeeds',
      async () => {
        let shouldFail = true;

        const worker = new Worker(
          queueName,
          async () => {
            if (shouldFail) {
              throw new Error('fail');
            }
          },
          {
            connection,
            prefix,
            circuitBreaker: { threshold: 1, duration: 200 },
            autorun: true,
          },
        );

        await worker.waitUntilReady();

        // Trip the circuit
        await queue.add('fail-job', {}, { attempts: 1 });
        await new Promise<void>(resolve => worker.on('circuit:open', resolve));

        // Allow the next job to succeed
        shouldFail = false;

        // Wait for HALF_OPEN, then add a test job
        await new Promise<void>(resolve =>
          worker.on('circuit:half-open', resolve),
        );
        await queue.add('test-job', {}, { attempts: 1 });

        await new Promise<void>(resolve =>
          worker.on('circuit:closed', resolve),
        );
        expect(worker.getCircuitBreakerState()).toBe('closed');

        await worker.close();
      },
      TEST_TIMEOUT,
    );

    it(
      'emits circuit:closed event with { testJobId } payload (VAL-13)',
      async () => {
        let shouldFail = true;
        const worker = new Worker(
          queueName,
          async () => {
            if (shouldFail) {
              throw new Error('fail');
            }
          },
          {
            connection,
            prefix,
            circuitBreaker: { threshold: 1, duration: 200 },
            autorun: true,
          },
        );

        await worker.waitUntilReady();

        await queue.add('fail-job', {}, { attempts: 1 });
        await new Promise<void>(resolve => worker.on('circuit:open', resolve));

        shouldFail = false;
        await new Promise<void>(resolve =>
          worker.on('circuit:half-open', resolve),
        );

        const testJob = await queue.add('test-job', {}, { attempts: 1 });

        let closedPayload: { testJobId: string } | undefined;
        const closedPromise = new Promise<void>(resolve => {
          worker.on('circuit:closed', payload => {
            closedPayload = payload;
            resolve();
          });
        });

        await closedPromise;
        expect(closedPayload).toBeDefined();
        expect(closedPayload!.testJobId).toBe(testJob.id);

        await worker.close();
      },
      TEST_TIMEOUT,
    );

    it(
      'worker resumes normal fetching after circuit closes',
      async () => {
        let shouldFail = true;
        let completedCount = 0;

        const worker = new Worker(
          queueName,
          async () => {
            if (shouldFail) {
              throw new Error('fail');
            }
            completedCount++;
          },
          {
            connection,
            prefix,
            circuitBreaker: { threshold: 1, duration: 200 },
            autorun: true,
          },
        );

        await worker.waitUntilReady();

        await queue.add('fail-job', {}, { attempts: 1 });
        await new Promise<void>(resolve => worker.on('circuit:open', resolve));

        shouldFail = false;
        await new Promise<void>(resolve =>
          worker.on('circuit:half-open', resolve),
        );
        await queue.add('test-job', {}, { attempts: 1 });

        await new Promise<void>(resolve =>
          worker.on('circuit:closed', resolve),
        );

        // Add more jobs after closed — they should be processed
        await queue.add('normal-job', {}, { attempts: 1 });
        await delay(1000);

        expect(completedCount).toBeGreaterThanOrEqual(2);

        await worker.close();
      },
      TEST_TIMEOUT,
    );
  });

  // CB-2 / VAL-14: HALF_OPEN → OPEN on failed test job
  describe('HALF_OPEN → OPEN re-trip (VAL-14)', () => {
    it(
      'getCircuitBreakerState() returns "open" when test job fails in HALF_OPEN',
      async () => {
        const worker = new Worker(
          queueName,
          async () => {
            throw new Error('always fail');
          },
          {
            connection,
            prefix,
            circuitBreaker: { threshold: 1, duration: 200 },
            autorun: true,
          },
        );

        await worker.waitUntilReady();

        await queue.add('job', {}, { attempts: 1 });
        await new Promise<void>(resolve => worker.on('circuit:open', resolve));
        await new Promise<void>(resolve =>
          worker.on('circuit:half-open', resolve),
        );

        // Add a test job — it will fail → circuit back to OPEN
        await queue.add('test-job', {}, { attempts: 1 });

        // Wait for the next circuit:open event (the first one was already consumed above)
        await new Promise<void>(resolve =>
          worker.once('circuit:open', resolve),
        );
        expect(worker.getCircuitBreakerState()).toBe('open');

        await worker.close();
      },
      TEST_TIMEOUT,
    );

    it(
      'duration timer restarts after re-trip',
      async () => {
        const duration = 200;
        const worker = new Worker(
          queueName,
          async () => {
            throw new Error('always fail');
          },
          {
            connection,
            prefix,
            circuitBreaker: { threshold: 1, duration },
            autorun: true,
          },
        );

        await worker.waitUntilReady();

        await queue.add('job', {}, { attempts: 1 });
        await new Promise<void>(resolve => worker.on('circuit:open', resolve));
        await new Promise<void>(resolve =>
          worker.on('circuit:half-open', resolve),
        );

        // Test job fails, circuit re-opens; the previous circuit:open listener was already consumed
        await queue.add('test-job', {}, { attempts: 1 });
        await new Promise<void>(resolve =>
          worker.once('circuit:open', resolve),
        );

        // Timer should restart — after duration ms, we should get half-open again
        // The previous circuit:half-open listener was already consumed above
        await new Promise<void>(resolve =>
          worker.once('circuit:half-open', resolve),
        );
        expect(worker.getCircuitBreakerState()).toBe('half-open');

        await worker.close();
      },
      TEST_TIMEOUT,
    );
  });

  // CB-4 / VAL-17: Worker lifecycle — close() during OPEN
  describe('lifecycle: close() during OPEN (VAL-17)', () => {
    it(
      'close() resolves without waiting for duration timer when OPEN',
      async () => {
        const worker = new Worker(
          queueName,
          async () => {
            throw new Error('fail');
          },
          {
            connection,
            prefix,
            circuitBreaker: { threshold: 1, duration: 60000 },
            autorun: true,
          },
        );

        await worker.waitUntilReady();
        await queue.add('job', {}, { attempts: 1 });

        await new Promise<void>(resolve => worker.on('circuit:open', resolve));
        expect(worker.getCircuitBreakerState()).toBe('open');

        const closeStart = Date.now();
        await worker.close();
        const closeTime = Date.now() - closeStart;

        // Should complete well before the 60-second duration timer
        expect(closeTime).toBeLessThan(5000);
      },
      TEST_TIMEOUT,
    );

    it(
      'no circuit breaker events fire after close()',
      async () => {
        const worker = new Worker(
          queueName,
          async () => {
            throw new Error('fail');
          },
          {
            connection,
            prefix,
            circuitBreaker: { threshold: 1, duration: 200 },
            autorun: true,
          },
        );

        await worker.waitUntilReady();
        await queue.add('job', {}, { attempts: 1 });
        await new Promise<void>(resolve => worker.on('circuit:open', resolve));

        await worker.close();

        const eventsAfterClose: string[] = [];
        worker.on('circuit:half-open', () =>
          eventsAfterClose.push('half-open'),
        );
        worker.on('circuit:closed', () => eventsAfterClose.push('closed'));

        // Wait past the duration
        await delay(500);
        expect(eventsAfterClose).toHaveLength(0);
      },
      TEST_TIMEOUT,
    );
  });

  // CB-4 / VAL-18: Stalled jobs do not affect circuit breaker
  describe('stalled jobs do not increment failure counter (VAL-18)', () => {
    it(
      'failure counter remains unchanged after a job stall',
      async () => {
        const threshold = 3;

        // Worker 1: hangs indefinitely and is force-closed to abandon its lock.
        const worker1 = new Worker(
          queueName,
          async () => {
            await delay(60000);
          },
          {
            connection,
            prefix,
            autorun: true,
            lockDuration: 1000,
            stalledInterval: 100,
            maxStalledCount: 0,
          },
        );

        await worker1.waitUntilReady();
        await queue.add('stall-job', {}, { attempts: 1 });

        // Wait for the job to become active, then force-close to abandon the lock.
        await new Promise<void>(resolve => worker1.on('active', resolve));
        await worker1.close(true);

        // Worker 2: runs the stalled checker. It has the circuit breaker configured.
        const worker2 = new Worker(queueName, async () => {}, {
          connection,
          prefix,
          circuitBreaker: { threshold, duration: 10000 },
          autorun: true,
          stalledInterval: 100,
          maxStalledCount: 0,
        });

        await worker2.waitUntilReady();

        const openEvents: string[] = [];
        worker2.on('circuit:open', () => openEvents.push('open'));

        // Wait for the stall to be detected
        await new Promise<void>(resolve => worker2.on('stalled', resolve));

        // Give time for any would-be circuit open event to fire (it shouldn't)
        await delay(300);
        expect(openEvents).toHaveLength(0);
        expect(worker2.getCircuitBreakerState()).toBe('closed');

        await worker2.close();
      },
      TEST_TIMEOUT,
    );
  });

  // CB-3: Event payloads are correctly typed and fired exactly once
  describe('circuit breaker events (CB-3)', () => {
    it(
      'circuit:open fires exactly once per CLOSED → OPEN transition',
      async () => {
        const worker = new Worker(
          queueName,
          async () => {
            throw new Error('fail');
          },
          {
            connection,
            prefix,
            circuitBreaker: { threshold: 2, duration: 10000 },
            autorun: true,
          },
        );

        await worker.waitUntilReady();

        let openCount = 0;
        const openPromise = new Promise<void>(resolve => {
          worker.on('circuit:open', () => {
            openCount++;
            if (openCount === 1) {
              resolve();
            }
          });
        });

        for (let i = 0; i < 2; i++) {
          await queue.add('job', {}, { attempts: 1 });
        }

        await openPromise;
        await delay(200);
        expect(openCount).toBe(1);

        await worker.close();
      },
      TEST_TIMEOUT,
    );

    it(
      'circuit:half-open fires exactly once per OPEN → HALF_OPEN transition',
      async () => {
        const worker = new Worker(
          queueName,
          async () => {
            throw new Error('fail');
          },
          {
            connection,
            prefix,
            circuitBreaker: { threshold: 1, duration: 200 },
            autorun: true,
          },
        );

        await worker.waitUntilReady();

        let halfOpenCount = 0;
        const halfOpenPromise = new Promise<void>(resolve => {
          worker.on('circuit:half-open', () => {
            halfOpenCount++;
            if (halfOpenCount === 1) {
              resolve();
            }
          });
        });

        await queue.add('job', {}, { attempts: 1 });
        await new Promise<void>(resolve => worker.on('circuit:open', resolve));
        await halfOpenPromise;
        await delay(50);

        expect(halfOpenCount).toBe(1);

        await worker.close();
      },
      TEST_TIMEOUT,
    );

    it(
      'circuit:closed fires exactly once per HALF_OPEN → CLOSED transition',
      async () => {
        let shouldFail = true;
        const worker = new Worker(
          queueName,
          async () => {
            if (shouldFail) {
              throw new Error('fail');
            }
          },
          {
            connection,
            prefix,
            circuitBreaker: { threshold: 1, duration: 200 },
            autorun: true,
          },
        );

        await worker.waitUntilReady();

        let closedCount = 0;
        const closedPromise = new Promise<void>(resolve => {
          worker.on('circuit:closed', () => {
            closedCount++;
            if (closedCount === 1) {
              resolve();
            }
          });
        });

        await queue.add('fail-job', {}, { attempts: 1 });
        await new Promise<void>(resolve => worker.on('circuit:open', resolve));

        shouldFail = false;
        await new Promise<void>(resolve =>
          worker.on('circuit:half-open', resolve),
        );
        await queue.add('test-job', {}, { attempts: 1 });

        await closedPromise;
        await delay(50);
        expect(closedCount).toBe(1);

        await worker.close();
      },
      TEST_TIMEOUT,
    );

    it(
      'no circuit events fire when circuitBreaker is not configured',
      async () => {
        const worker = new Worker(
          queueName,
          async () => {
            throw new Error('fail');
          },
          { connection, prefix, autorun: true },
        );

        await worker.waitUntilReady();

        const circuitEvents: string[] = [];
        worker.on('circuit:open', () => circuitEvents.push('open'));
        worker.on('circuit:half-open', () => circuitEvents.push('half-open'));
        worker.on('circuit:closed', () => circuitEvents.push('closed'));

        for (let i = 0; i < 5; i++) {
          await queue.add('job', {}, { attempts: 1 });
        }

        await delay(1000);
        expect(circuitEvents).toHaveLength(0);

        await worker.close();
      },
      TEST_TIMEOUT,
    );
  });
});
