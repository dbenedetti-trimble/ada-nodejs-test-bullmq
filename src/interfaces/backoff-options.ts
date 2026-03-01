/**
 * Settings for backing off failed jobs.
 *
 * @see {@link https://docs.bullmq.io/guide/retrying-failing-jobs}
 */
export interface BackoffOptions {
  /**
   * Name of the backoff strategy.
   */
  type:
    | 'fixed'
    | 'exponential'
    | 'linear'
    | 'polynomial'
    | 'decorrelatedJitter'
    | (string & {});

  /**
   * Delay in milliseconds.
   */
  delay?: number;

  /**
   * Percentage of jitter usage.
   * @defaultValue 0
   */
  jitter?: number;

  /**
   * Maximum delay in milliseconds. When set to a positive number, the computed
   * delay (after strategy and jitter) is clamped to this value. A value of 0
   * is treated as "no cap". Applies to all strategies including custom callbacks.
   */
  maxDelay?: number;

  /**
   * Exponent used by the `polynomial` backoff strategy.
   * @defaultValue 2
   */
  exponent?: number;
}
