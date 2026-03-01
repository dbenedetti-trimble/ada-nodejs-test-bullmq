import { BackoffOptions } from '../interfaces/backoff-options';
import { MinimalJob } from '../interfaces/minimal-job';
import { BackoffStrategy } from '../types/backoff-strategy';

export interface BuiltInStrategies {
  [index: string]: (delay: number, jitter?: number) => BackoffStrategy;
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

      if (result instanceof Promise) {
        return result.then(computedDelay =>
          applyMaxDelay(computedDelay, backoff.maxDelay),
        );
      }

      return applyMaxDelay(result as number, backoff.maxDelay);
    }
  }
}

function applyMaxDelay(
  computedDelay: number,
  maxDelay?: number,
): number {
  if (maxDelay && maxDelay > 0) {
    return Math.min(computedDelay, maxDelay);
  }
  return computedDelay;
}

function lookupStrategy(
  backoff: BackoffOptions,
  customStrategy?: BackoffStrategy,
): BackoffStrategy {
  if (backoff.type === 'polynomial') {
    const exponent = backoff.exponent ?? 2;
    if (exponent <= 0) {
      throw new Error(
        'polynomial backoff strategy requires a positive exponent.',
      );
    }
    const delay = backoff.delay ?? 0;
    const jitter = backoff.jitter ?? 0;
    return function (attemptsMade: number): number {
      const rawDelay = delay * Math.pow(attemptsMade, exponent);
      if (jitter > 0) {
        const minDelay = rawDelay * (1 - jitter);
        return Math.floor(Math.random() * rawDelay * jitter + minDelay);
      }
      return rawDelay;
    };
  }

  if (backoff.type === 'decorrelatedJitter') {
    const baseDelay = backoff.delay ?? 1000;
    const maxDelay = backoff.maxDelay;
    return async function (
      _attemptsMade: number,
      _type?: string,
      _err?: Error,
      job?: MinimalJob,
    ): Promise<number> {
      const prevDelay: number =
        (job?.data as Record<string, unknown>)?.__bullmq_prevDelay as number ??
        baseDelay;

      const upperBound = prevDelay * 3;
      const range = upperBound - baseDelay;
      const newDelay = baseDelay + Math.random() * range;
      const clampedDelay = maxDelay
        ? Math.min(newDelay, maxDelay)
        : newDelay;

      if (job) {
        await job.updateData({
          ...job.data,
          __bullmq_prevDelay: clampedDelay,
        });
      }

      return clampedDelay;
    };
  }

  if (backoff.type in Backoffs.builtinStrategies) {
    return Backoffs.builtinStrategies[backoff.type](
      backoff.delay!,
      backoff.jitter,
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
