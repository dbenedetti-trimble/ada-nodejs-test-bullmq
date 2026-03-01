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
   * Maximum delay in milliseconds. Caps the computed delay for any strategy after
   * jitter is applied. A value of 0 is treated as "no cap".
   */
  maxDelay?: number;

  /**
   * Exponent used by the `polynomial` strategy.
   * Must be a positive number.
   * @defaultValue 2
   */
  exponent?: number;
}
