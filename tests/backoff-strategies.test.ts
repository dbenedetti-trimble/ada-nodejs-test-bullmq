'use strict';

import { default as IORedis } from 'ioredis';
import { describe, beforeAll, afterAll, it, expect } from 'vitest';

import { v4 } from 'uuid';
import { Backoffs } from '../src/classes/backoffs';
import { removeAllQueueData } from '../src/utils';
import { BackoffOptions } from '../src/interfaces';

// ---------------------------------------------------------------------------
// Unit tests for new backoff strategies and maxDelay clamping.
// These tests call Backoffs.calculate() directly; no Redis is required for
// most cases. Tests that exercise errorBackoffs resolution via Job.shouldRetryJob
// use a real Queue + Worker setup.
// ---------------------------------------------------------------------------

describe('Backoff strategies', () => {
  // VAL-01: Linear backoff produces linearly increasing delays
  describe('linear strategy', () => {
    it.todo('produces delay = baseDelay * attemptsMade for attempt 1');
    it.todo('produces delay = baseDelay * attemptsMade for attempt 2');
    it.todo('produces delay = baseDelay * attemptsMade for attempt 3');
    it.todo('applies jitter within [delay*(1-jitter), delay] range (VAL-19)');
    it.todo('is registered in Backoffs.builtinStrategies');
  });

  // VAL-02 / VAL-03: Polynomial backoff
  describe('polynomial strategy', () => {
    it.todo('defaults to exponent 2 (quadratic) when exponent is omitted');
    it.todo('computes delay = baseDelay * attemptsMade^exponent for exponent 2');
    it.todo('computes delay = baseDelay * attemptsMade^exponent for exponent 3');
    it.todo('applies jitter identically to other strategies');
    it.todo('throws when exponent is non-positive');
    it.todo('is registered in Backoffs.builtinStrategies');
  });

  // VAL-04: Decorrelated jitter
  describe('decorrelatedJitter strategy', () => {
    it.todo('produces delay >= baseDelay on every attempt');
    it.todo('respects maxDelay cap on every attempt');
    it.todo('delays are not monotonically increasing (randomness present)');
    it.todo('persists previous delay state across attempts');
    it.todo('ignores jitter option (jitter is inherent to the algorithm)');
    it.todo('is registered in Backoffs.builtinStrategies');
  });

  // VAL-05 / VAL-06: maxDelay clamping
  describe('maxDelay clamping', () => {
    it.todo('caps exponential delay when raw delay exceeds maxDelay (VAL-05)');
    it.todo('caps linear delay when raw delay exceeds maxDelay (VAL-06)');
    it.todo('passes through delay unchanged when below maxDelay');
    it.todo('treats maxDelay = 0 as no cap');
    it.todo('caps delays from custom backoffStrategy callbacks');
    it.todo('throws when maxDelay is negative');
  });

  // VAL-07 / VAL-08: Per-error-type backoff (errorBackoffs)
  describe('errorBackoffs resolution', () => {
    it.todo(
      'selects error-specific backoff when error.name matches a key (VAL-07)',
    );
    it.todo(
      'falls back to default backoff when error.name has no match (VAL-08)',
    );
    it.todo(
      'uses no backoff (delay 0) when errorBackoffs is set but backoff is not and no key matches',
    );
    it.todo('omitting errorBackoffs preserves current behavior exactly');
    it.todo('respects maxDelay on individual errorBackoffs entries');
  });

  // VAL-09 / VAL-10: Regression — existing strategies unchanged
  describe('existing strategies (regression)', () => {
    it.todo('fixed strategy produces identical output to current behavior (VAL-09)');
    it.todo('exponential strategy produces identical output to current behavior (VAL-10)');
  });
});
