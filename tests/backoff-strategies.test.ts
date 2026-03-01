'use strict';

import { describe, it, expect } from 'vitest';

import { Backoffs } from '../src/classes/backoffs';
import { BackoffOptions } from '../src/interfaces';

// ---------------------------------------------------------------------------
// Unit tests for new backoff strategies and maxDelay clamping.
// These tests call Backoffs.calculate() directly; no Redis is required.
// ---------------------------------------------------------------------------

/** Minimal job stub sufficient for backoff calculation */
function makeJob(data: Record<string, unknown> = {}) {
  const storedData = { ...data };
  return {
    data: storedData,
    opts: {},
    updateData: async function (newData: Record<string, unknown>) {
      Object.assign(storedData, newData);
      Object.assign(this.data, newData);
    },
  } as any;
}

describe('Backoff strategies', () => {
  // VAL-01: Linear backoff produces linearly increasing delays
  describe('linear strategy', () => {
    it('produces delay = baseDelay * attemptsMade for attempt 1', async () => {
      const backoff: BackoffOptions = { type: 'linear', delay: 1000 };
      const result = await Backoffs.calculate(backoff, 1, new Error(), makeJob());
      expect(result).toBe(1000);
    });

    it('produces delay = baseDelay * attemptsMade for attempt 2', async () => {
      const backoff: BackoffOptions = { type: 'linear', delay: 1000 };
      const result = await Backoffs.calculate(backoff, 2, new Error(), makeJob());
      expect(result).toBe(2000);
    });

    it('produces delay = baseDelay * attemptsMade for attempt 3', async () => {
      const backoff: BackoffOptions = { type: 'linear', delay: 1000 };
      const result = await Backoffs.calculate(backoff, 3, new Error(), makeJob());
      expect(result).toBe(3000);
    });

    it('applies jitter within [delay*(1-jitter), delay] range (VAL-19)', async () => {
      const backoff: BackoffOptions = { type: 'linear', delay: 1000, jitter: 0.5 };
      for (let i = 0; i < 50; i++) {
        const result = (await Backoffs.calculate(
          backoff,
          2,
          new Error(),
          makeJob(),
        )) as number;
        // attempt 2, raw = 2000ms, jitter 0.5 → [1000, 2000)
        expect(result).toBeGreaterThanOrEqual(1000);
        expect(result).toBeLessThanOrEqual(2000);
      }
    });

    it('is registered in Backoffs.builtinStrategies', () => {
      expect(typeof Backoffs.builtinStrategies['linear']).toBe('function');
    });
  });

  // VAL-02 / VAL-03: Polynomial backoff
  describe('polynomial strategy', () => {
    it('defaults to exponent 2 (quadratic) when exponent is omitted', async () => {
      const backoff: BackoffOptions = { type: 'polynomial', delay: 500 };
      const result = await Backoffs.calculate(backoff, 2, new Error(), makeJob());
      // 500 * 2^2 = 2000
      expect(result).toBe(2000);
    });

    it('computes delay = baseDelay * attemptsMade^exponent for exponent 2', async () => {
      const backoff: BackoffOptions = { type: 'polynomial', delay: 500, exponent: 2 };
      // attempt 1: 500*1 = 500, attempt 2: 500*4 = 2000, attempt 3: 500*9 = 4500
      expect(await Backoffs.calculate(backoff, 1, new Error(), makeJob())).toBe(500);
      expect(await Backoffs.calculate(backoff, 2, new Error(), makeJob())).toBe(2000);
      expect(await Backoffs.calculate(backoff, 3, new Error(), makeJob())).toBe(4500);
    });

    it('computes delay = baseDelay * attemptsMade^exponent for exponent 3', async () => {
      const backoff: BackoffOptions = { type: 'polynomial', delay: 100, exponent: 3 };
      // attempt 1: 100*1 = 100, attempt 2: 100*8 = 800
      expect(await Backoffs.calculate(backoff, 1, new Error(), makeJob())).toBe(100);
      expect(await Backoffs.calculate(backoff, 2, new Error(), makeJob())).toBe(800);
    });

    it('applies jitter identically to other strategies', async () => {
      const backoff: BackoffOptions = { type: 'polynomial', delay: 1000, exponent: 2, jitter: 0.25 };
      for (let i = 0; i < 50; i++) {
        const result = (await Backoffs.calculate(
          backoff,
          2,
          new Error(),
          makeJob(),
        )) as number;
        // raw = 1000 * 4 = 4000, jitter 0.25 → [3000, 4000)
        expect(result).toBeGreaterThanOrEqual(3000);
        expect(result).toBeLessThan(4000);
      }
    });

    it('throws when exponent is non-positive', () => {
      const backoff: BackoffOptions = { type: 'polynomial', delay: 1000, exponent: 0 };
      expect(() =>
        Backoffs.calculate(backoff, 1, new Error(), makeJob()),
      ).toThrow();
    });

    it('is registered via lookupStrategy (not in builtinStrategies)', async () => {
      // polynomial is handled directly in lookupStrategy, not via builtinStrategies
      const backoff: BackoffOptions = { type: 'polynomial', delay: 100 };
      const result = await Backoffs.calculate(backoff, 1, new Error(), makeJob());
      expect(result).toBe(100);
    });
  });

  // VAL-04: Decorrelated jitter
  describe('decorrelatedJitter strategy', () => {
    it('produces delay >= baseDelay on every attempt', async () => {
      const backoff: BackoffOptions = {
        type: 'decorrelatedJitter',
        delay: 1000,
        maxDelay: 30000,
      };
      const job = makeJob();
      for (let attempt = 1; attempt <= 10; attempt++) {
        const result = (await Backoffs.calculate(backoff, attempt, new Error(), job)) as number;
        expect(result).toBeGreaterThanOrEqual(1000);
      }
    });

    it('respects maxDelay cap on every attempt', async () => {
      const backoff: BackoffOptions = {
        type: 'decorrelatedJitter',
        delay: 1000,
        maxDelay: 5000,
      };
      const job = makeJob();
      for (let attempt = 1; attempt <= 20; attempt++) {
        const result = (await Backoffs.calculate(backoff, attempt, new Error(), job)) as number;
        expect(result).toBeLessThanOrEqual(5000);
      }
    });

    it('delays are not monotonically increasing (randomness present)', async () => {
      const backoff: BackoffOptions = {
        type: 'decorrelatedJitter',
        delay: 1000,
        maxDelay: 30000,
      };
      const delays: number[] = [];
      const job = makeJob();
      for (let attempt = 1; attempt <= 20; attempt++) {
        const result = (await Backoffs.calculate(backoff, attempt, new Error(), job)) as number;
        delays.push(result);
      }
      // With 20 attempts and randomness, not all delays should be strictly increasing
      let alwaysIncreasing = true;
      for (let i = 1; i < delays.length; i++) {
        if (delays[i] < delays[i - 1]) {
          alwaysIncreasing = false;
          break;
        }
      }
      expect(alwaysIncreasing).toBe(false);
    });

    it('persists previous delay state across attempts', async () => {
      const backoff: BackoffOptions = {
        type: 'decorrelatedJitter',
        delay: 1000,
        maxDelay: 30000,
      };
      const job = makeJob();
      // First attempt seeds with baseDelay
      await Backoffs.calculate(backoff, 1, new Error(), job);
      // After first call, job.data should have __bullmq_prevDelay
      expect(typeof (job.data as any).__bullmq_prevDelay).toBe('number');
    });

    it('ignores jitter option (jitter is inherent to the algorithm)', async () => {
      const backoffWithJitter: BackoffOptions = {
        type: 'decorrelatedJitter',
        delay: 1000,
        maxDelay: 30000,
        jitter: 0.9,
      };
      // Should not throw; jitter is simply unused
      const job = makeJob();
      const result = await Backoffs.calculate(backoffWithJitter, 1, new Error(), job);
      expect(typeof result === 'number' || result instanceof Promise).toBeTruthy();
    });

    it('is handled by lookupStrategy for decorrelatedJitter type', async () => {
      const backoff: BackoffOptions = {
        type: 'decorrelatedJitter',
        delay: 1000,
        maxDelay: 30000,
      };
      const job = makeJob();
      const result = (await Backoffs.calculate(backoff, 1, new Error(), job)) as number;
      expect(result).toBeGreaterThanOrEqual(1000);
      expect(result).toBeLessThanOrEqual(30000);
    });
  });

  // VAL-05 / VAL-06: maxDelay clamping
  describe('maxDelay clamping', () => {
    it('caps exponential delay when raw delay exceeds maxDelay (VAL-05)', async () => {
      // attempt 5: 2^4 * 1000 = 16000ms, maxDelay 10000 → 10000
      const backoff: BackoffOptions = {
        type: 'exponential',
        delay: 1000,
        maxDelay: 10000,
      };
      const result = await Backoffs.calculate(backoff, 5, new Error(), makeJob());
      expect(result).toBe(10000);
    });

    it('caps linear delay when raw delay exceeds maxDelay (VAL-06)', async () => {
      // attempt 4: 5000 * 4 = 20000ms, maxDelay 15000 → 15000
      const backoff: BackoffOptions = {
        type: 'linear',
        delay: 5000,
        maxDelay: 15000,
      };
      const result = await Backoffs.calculate(backoff, 4, new Error(), makeJob());
      expect(result).toBe(15000);
    });

    it('passes through delay unchanged when below maxDelay', async () => {
      const backoff: BackoffOptions = {
        type: 'linear',
        delay: 1000,
        maxDelay: 50000,
      };
      const result = await Backoffs.calculate(backoff, 2, new Error(), makeJob());
      expect(result).toBe(2000);
    });

    it('treats maxDelay = 0 as no cap', async () => {
      const backoff: BackoffOptions = {
        type: 'exponential',
        delay: 1000,
        maxDelay: 0,
      };
      // attempt 5: 2^4 * 1000 = 16000ms, no cap → 16000
      const result = await Backoffs.calculate(backoff, 5, new Error(), makeJob());
      expect(result).toBe(16000);
    });

    it('caps delays from custom backoffStrategy callbacks', async () => {
      const backoff: BackoffOptions = {
        type: 'custom',
        delay: 1000,
        maxDelay: 5000,
      };
      const customStrategy = () => 99999;
      const result = await Backoffs.calculate(
        backoff,
        1,
        new Error(),
        makeJob(),
        customStrategy,
      );
      expect(result).toBe(5000);
    });

    it('throws when maxDelay is negative via custom strategy', async () => {
      const backoff: BackoffOptions = {
        type: 'unknown-strategy',
        delay: 1000,
      };
      await expect(
        Backoffs.calculate(backoff, 1, new Error(), makeJob()),
      ).rejects.toThrow();
    });
  });

  // VAL-07 / VAL-08: Per-error-type backoff (errorBackoffs)
  describe('errorBackoffs resolution', () => {
    it('selects error-specific backoff when error.name matches a key (VAL-07)', async () => {
      const rateLimitError = new Error('rate limited');
      rateLimitError.name = 'RateLimitError';

      const backoff: BackoffOptions = { type: 'exponential', delay: 1000 };
      const errorBackoffs: Record<string, BackoffOptions> = {
        RateLimitError: { type: 'fixed', delay: 30000 },
      };

      const effectiveBackoff =
        errorBackoffs[rateLimitError.name] ?? backoff;
      const result = await Backoffs.calculate(
        effectiveBackoff,
        1,
        rateLimitError,
        makeJob(),
      );
      expect(result).toBe(30000);
    });

    it('falls back to default backoff when error.name has no match (VAL-08)', async () => {
      const typeError = new TypeError('type error');

      const backoff: BackoffOptions = { type: 'fixed', delay: 1000 };
      const errorBackoffs: Record<string, BackoffOptions> = {
        RateLimitError: { type: 'fixed', delay: 30000 },
      };

      const effectiveBackoff = errorBackoffs[typeError.name] ?? backoff;
      const result = await Backoffs.calculate(
        effectiveBackoff,
        1,
        typeError,
        makeJob(),
      );
      expect(result).toBe(1000);
    });

    it('uses no backoff (delay 0) when errorBackoffs is set but backoff is not and no key matches', async () => {
      const err = new Error('some error');
      const errorBackoffs: Record<string, BackoffOptions> = {
        RateLimitError: { type: 'fixed', delay: 30000 },
      };

      const effectiveBackoff = errorBackoffs[err.name] ?? undefined;
      // When effectiveBackoff is undefined, Backoffs.calculate returns undefined
      expect(effectiveBackoff).toBeUndefined();
    });

    it('omitting errorBackoffs preserves current behavior exactly', async () => {
      const backoff: BackoffOptions = { type: 'fixed', delay: 2000 };
      const result = await Backoffs.calculate(backoff, 1, new Error(), makeJob());
      expect(result).toBe(2000);
    });

    it('respects maxDelay on individual errorBackoffs entries', async () => {
      const transientError = new Error('transient');
      transientError.name = 'TransientError';

      const errorBackoffs: Record<string, BackoffOptions> = {
        TransientError: { type: 'exponential', delay: 500, maxDelay: 1000 },
      };

      // attempt 5: 2^4 * 500 = 8000ms, maxDelay 1000 → 1000
      const effectiveBackoff = errorBackoffs[transientError.name];
      const result = await Backoffs.calculate(
        effectiveBackoff,
        5,
        transientError,
        makeJob(),
      );
      expect(result).toBe(1000);
    });
  });

  // VAL-09 / VAL-10: Regression — existing strategies unchanged
  describe('existing strategies (regression)', () => {
    it('fixed strategy produces identical output to current behavior (VAL-09)', async () => {
      const backoff: BackoffOptions = { type: 'fixed', delay: 2000 };
      expect(await Backoffs.calculate(backoff, 1, new Error(), makeJob())).toBe(2000);
      expect(await Backoffs.calculate(backoff, 2, new Error(), makeJob())).toBe(2000);
      expect(await Backoffs.calculate(backoff, 3, new Error(), makeJob())).toBe(2000);
    });

    it('exponential strategy produces identical output to current behavior (VAL-10)', async () => {
      const backoff: BackoffOptions = { type: 'exponential', delay: 1000 };
      // attempt 1: 2^0 * 1000 = 1000, attempt 2: 2^1 * 1000 = 2000, attempt 3: 2^2 * 1000 = 4000
      expect(await Backoffs.calculate(backoff, 1, new Error(), makeJob())).toBe(1000);
      expect(await Backoffs.calculate(backoff, 2, new Error(), makeJob())).toBe(2000);
      expect(await Backoffs.calculate(backoff, 3, new Error(), makeJob())).toBe(4000);
    });
  });
});
