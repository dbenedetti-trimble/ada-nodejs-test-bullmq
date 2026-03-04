import { BackoffOptions } from '../interfaces/backoff-options';
import { MinimalJob } from '../interfaces/minimal-job';
import { BackoffStrategy } from '../types/backoff-strategy';

export interface BuiltInStrategies {
  [index: string]: (
    delay: number,
    jitter?: number,
    opts?: BackoffOptions,
  ) => BackoffStrategy;
}

export class Backoffs {
  static builtinStrategies: BuiltInStrategies = {
    fixed: function (delay: number, jitter = 0) {
      return function (): number {
        if (jitter > 0) {
          const minDelay = delay * (1 - jitter);

          return Math.floor(Math.random() * delay * jitter + minDelay);
        } else {
          return delay;
        }
      };
    },

    exponential: function (delay: number, jitter = 0) {
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

    linear: function (delay: number, jitter = 0) {
      return function (attemptsMade: number): number {
        const rawDelay = delay * attemptsMade;
        if (jitter > 0) {
          const minDelay = rawDelay * (1 - jitter);
          return Math.floor(Math.random() * rawDelay * jitter + minDelay);
        }
        return rawDelay;
      };
    },

    polynomial: function (delay: number, jitter = 0, opts?: BackoffOptions) {
      const exponent = opts?.exponent ?? 2;
      if (typeof exponent !== 'number' || exponent <= 0) {
        throw new Error(
          'Polynomial backoff: exponent must be a positive number',
        );
      }
      return function (attemptsMade: number): number {
        const rawDelay = delay * Math.pow(attemptsMade, exponent);
        if (jitter > 0) {
          const minDelay = rawDelay * (1 - jitter);
          return Math.floor(Math.random() * rawDelay * jitter + minDelay);
        }
        return rawDelay;
      };
    },

    decorrelatedJitter: function (
      delay: number,
      _jitter = 0,
      opts?: BackoffOptions,
    ) {
      const maxDelayCap = opts?.maxDelay || 0;
      return function (
        attemptsMade: number,
        _type?: string,
        _err?: Error,
        job?: MinimalJob,
      ): number {
        const prevDelay =
          attemptsMade > 1 &&
          job?.data &&
          typeof job.data === 'object' &&
          (job.data as any).__bullmq_prevDelay
            ? (job.data as any).__bullmq_prevDelay
            : delay;
        const upper = prevDelay * 3;
        const computed = delay + Math.random() * (upper - delay);
        let result = Math.max(delay, computed);
        if (maxDelayCap > 0) {
          result = Math.min(maxDelayCap, result);
        }
        result = Math.round(result);
        if (job && job.data && typeof job.data === 'object') {
          (job.data as any).__bullmq_prevDelay = result;
        }
        return result;
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

  static async calculate(
    backoff: BackoffOptions,
    attemptsMade: number,
    err: Error,
    job: MinimalJob,
    customStrategy?: BackoffStrategy,
  ): Promise<number | undefined> {
    if (backoff) {
      if (
        backoff.maxDelay !== undefined &&
        typeof backoff.maxDelay === 'number' &&
        backoff.maxDelay < 0
      ) {
        throw new Error('maxDelay must be a positive number or 0');
      }

      const strategy = lookupStrategy(backoff, customStrategy);

      const rawDelay = await strategy(attemptsMade, backoff.type, err, job);

      if (
        typeof rawDelay === 'number' &&
        backoff.maxDelay &&
        backoff.maxDelay > 0 &&
        rawDelay > backoff.maxDelay
      ) {
        return backoff.maxDelay;
      }
      return rawDelay;
    }
  }
}

function lookupStrategy(
  backoff: BackoffOptions,
  customStrategy?: BackoffStrategy,
): BackoffStrategy {
  if (backoff.type in Backoffs.builtinStrategies) {
    return Backoffs.builtinStrategies[backoff.type](
      backoff.delay!,
      backoff.jitter,
      backoff,
    );
  } else if (customStrategy) {
    return customStrategy;
  } else {
    throw new Error(
      `Unknown backoff strategy ${backoff.type}.
      If a custom backoff strategy is used, specify it when the queue is created.`,
    );
  }
}
