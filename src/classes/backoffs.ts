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

    linear: function (opts: BackoffOptions): BackoffStrategy {
      const { delay = 0, jitter = 0 } = opts;
      return function (attemptsMade: number): number {
        const rawDelay = delay * attemptsMade;
        if (!jitter) {
          return rawDelay;
        }
        const min = rawDelay * (1 - jitter);
        return Math.floor(Math.random() * rawDelay * jitter + min);
      };
    },

    polynomial: function (opts: BackoffOptions): BackoffStrategy {
      const { delay = 0, jitter = 0, exponent = 2 } = opts;
      if (exponent <= 0) {
        throw new Error('exponent must be a positive number');
      }
      return function (attemptsMade: number): number {
        const rawDelay = delay * Math.pow(attemptsMade, exponent);
        if (!jitter) {
          return rawDelay;
        }
        const min = rawDelay * (1 - jitter);
        return Math.floor(Math.random() * rawDelay * jitter + min);
      };
    },

    decorrelatedJitter: function (opts: BackoffOptions): BackoffStrategy {
      const { delay: baseDelay = 0 } = opts;
      return function (
        _attemptsMade: number,
        _type?: string,
        _err?: Error,
        job?: MinimalJob,
      ): number {
        const prevDelay =
          (job?.data?.__bullmq_prevDelay as number) ?? baseDelay;
        const min = baseDelay;
        const max = prevDelay * 3;
        let computed = Math.floor(Math.random() * (max - min) + min);
        if (opts.maxDelay && opts.maxDelay > 0) {
          computed = Math.min(computed, opts.maxDelay);
        }
        if (job?.data) {
          (job.data as Record<string, unknown>).__bullmq_prevDelay = computed;
        }
        return computed;
      };
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

      if (backoff.maxDelay && backoff.maxDelay > 0) {
        if (result instanceof Promise) {
          return result.then(d => Math.min(d, backoff.maxDelay!));
        }
        return Math.min(result as number, backoff.maxDelay);
      }

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
