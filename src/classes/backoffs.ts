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

    polynomial: function (delay: number, jitter = 0) {
      return function (attemptsMade: number): number {
        return applyJitter(delay * Math.pow(attemptsMade, 2), jitter);
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
      if (
        backoff.maxDelay !== undefined &&
        backoff.maxDelay !== 0 &&
        backoff.maxDelay < 0
      ) {
        throw new Error('maxDelay must be a non-negative number');
      }

      if (backoff.type === 'decorrelatedJitter') {
        const result = Backoffs.calculateDecorrelatedJitter(backoff, job);
        return clampMaxDelay(result, backoff.maxDelay);
      }

      if (backoff.type === 'polynomial' && backoff.exponent !== undefined) {
        const exp = backoff.exponent;
        if (exp <= 0) {
          throw new Error('Polynomial exponent must be a positive number');
        }
        const rawDelay = backoff.delay! * Math.pow(attemptsMade, exp);
        const result = applyJitter(rawDelay, backoff.jitter || 0);
        return clampMaxDelay(result, backoff.maxDelay);
      }

      const strategy = lookupStrategy(backoff, customStrategy);
      const rawDelay = strategy(attemptsMade, backoff.type, err, job);

      if (rawDelay instanceof Promise) {
        return rawDelay.then(d => clampMaxDelay(d, backoff.maxDelay));
      }

      return clampMaxDelay(rawDelay, backoff.maxDelay);
    }
  }

  private static calculateDecorrelatedJitter(
    backoff: BackoffOptions,
    job: MinimalJob,
  ): number {
    const baseDelay = backoff.delay || 1000;
    const data = job.data as Record<string, any>;
    const prevDelay =
      typeof data?.__bullmq_prevDelay === 'number'
        ? data.__bullmq_prevDelay
        : baseDelay;

    const upper = prevDelay * 3;
    const computedDelay =
      baseDelay + Math.floor(Math.random() * (upper - baseDelay));
    const finalDelay = Math.max(baseDelay, computedDelay);

    if (data && typeof data === 'object') {
      data.__bullmq_prevDelay = finalDelay;
    }

    return finalDelay;
  }
}

function applyJitter(rawDelay: number, jitter: number): number {
  if (jitter > 0) {
    const minDelay = rawDelay * (1 - jitter);
    return Math.floor(Math.random() * rawDelay * jitter + minDelay);
  }
  return rawDelay;
}

function clampMaxDelay(delay: number, maxDelay: number | undefined): number {
  if (maxDelay && maxDelay > 0 && delay > maxDelay) {
    return maxDelay;
  }
  return delay;
}

function lookupStrategy(
  backoff: BackoffOptions,
  customStrategy?: BackoffStrategy,
): BackoffStrategy {
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
