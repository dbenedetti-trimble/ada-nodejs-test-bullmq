/**
 * Lifecycle events emitted at key points during job processing.
 */
export type LifecycleEvent =
  | 'job:added'
  | 'job:active'
  | 'job:completed'
  | 'job:failed'
  | 'job:retrying'
  | 'job:delayed'
  | 'job:stalled'
  | 'job:rate-limited';

/**
 * Structured log entry produced at each lifecycle point.
 */
export interface LifecycleLogEntry {
  /**
   * Unix timestamp (ms) at the point of the log call.
   */
  timestamp: number;

  /**
   * The lifecycle event that triggered this log entry.
   */
  event: LifecycleEvent;

  /**
   * The queue name string.
   */
  queue: string;

  /**
   * The job identifier.
   */
  jobId?: string;

  /**
   * The job name.
   */
  jobName?: string;

  /**
   * Number of attempts made so far.
   */
  attemptsMade?: number;

  /**
   * Duration in milliseconds (populated for completed and failed events).
   */
  duration?: number;

  /**
   * Event-specific extra data (e.g. failedReason, stacktrace, maxAttempts).
   */
  data?: Record<string, unknown>;
}

/**
 * Logger interface for structured job lifecycle logging.
 *
 * Users provide an implementation of this interface to receive structured
 * log entries at key lifecycle points during job processing.
 */
export interface LifecycleLogger {
  /**
   * Log a routine lifecycle event (e.g. job added, active, completed).
   *
   * @param entry - structured log entry
   */
  debug(entry: LifecycleLogEntry): void;

  /**
   * Log a warning lifecycle event (e.g. job retrying, stalled).
   *
   * @param entry - structured log entry
   */
  warn(entry: LifecycleLogEntry): void;

  /**
   * Log an error lifecycle event (e.g. job failed).
   *
   * @param entry - structured log entry
   */
  error(entry: LifecycleLogEntry): void;
}
