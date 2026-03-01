import { BackoffOptions } from '../interfaces/backoff-options';
import { MinimalJob } from '../interfaces/minimal-job';
import { BackoffStrategy } from '../types/backoff-strategy';

/**
 * Factory signature updated to accept the full BackoffOptions object so that
 * strategies like `polynomial` (needs `exponent`) and `decorrelatedJitter`
 * (needs job data access) can receive all relevant options.
 */
export interface BuiltInStrategies {
  [index: string]: (opts: BackoffOptions) => BackoffStrategy;
}

export class Backoffs {
  static builtinStrategies: BuiltInStrategies = {
    fixed: function (opts: BackoffOptions) {
      const { delay = 0, jitter = 0 } = opts;
      return function (): number {
        if (jitter > 0) {
          const minDelay = delay * (1 - jitter);
          return Math.floor(Math.random() * delay * jitter + minDelay);
        } else {
          return delay;
        }
      };
    },

    exponential: function (opts: BackoffOptions) {
      const { delay = 0, jitter = 0 } = opts;
      return function (attemptsMade: number): number {
        if (jitter > 0) {
          const maxDelay = Math.round(Math.pow(2, attemptsMade - 1) * delay);
          const minDelay = maxDelay * (1 - jitter);
          return Math.floor(Math.random() * maxDelay * jitter + minDelay);
        } else {
          return Math.round(Math.pow(2, attemptsMade - 1) * delay);
        }
      };
    },

    // TODO(features): implement linear strategy
    // Formula: delay * attemptsMade, with optional jitter in [delay*(1-jitter), delay]
    linear: function (_opts: BackoffOptions): BackoffStrategy {
      throw new Error('linear backoff strategy: not yet implemented');
    },

    // TODO(features): implement polynomial strategy
    // Formula: delay * (attemptsMade ^ exponent); exponent defaults to 2
    polynomial: function (_opts: BackoffOptions): BackoffStrategy {
      throw new Error('polynomial backoff strategy: not yet implemented');
    },

    // TODO(features): implement decorrelatedJitter strategy
    // Formula: min(maxDelay, random(baseDelay, prevDelay * 3))
    // Previous delay stored in job.data.__bullmq_prevDelay
    decorrelatedJitter: function (_opts: BackoffOptions): BackoffStrategy {
      throw new Error('decorrelatedJitter backoff strategy: not yet implemented');
    },
  };

  static normalize(
    backoff: number | BackoffOptions,
  ): BackoffOptions | undefined {
    if (Number.isFinite(<number>backoff)) {
      return {
        type: 'fixed',
        delay: <number>backoff,
      };
    } else if (backoff) {
      return <BackoffOptions>backoff;
    }
  }

  static calculate(
    backoff: BackoffOptions,
    attemptsMade: number,
    err: Error,
    job: MinimalJob,
    customStrategy?: BackoffStrategy,
  ): Promise<number> | number | undefined {
    if (backoff) {
      const strategy = lookupStrategy(backoff, customStrategy);
      const result = strategy(attemptsMade, backoff.type, err, job);

      // TODO(features): apply maxDelay clamping after strategy result
      // Handle both Promise<number> and number return types
      // if (backoff.maxDelay && backoff.maxDelay > 0) { ... }

      return result;
    }
  }
}

function lookupStrategy(
  backoff: BackoffOptions,
  customStrategy?: BackoffStrategy,
): BackoffStrategy {
  if (backoff.type in Backoffs.builtinStrategies) {
    return Backoffs.builtinStrategies[backoff.type](backoff);
  } else if (customStrategy) {
    return customStrategy;
  } else {
    throw new Error(
      `Unknown backoff strategy ${backoff.type}.
      If a custom backoff strategy is used, specify it when the queue is created.`,
    );
  }
}
