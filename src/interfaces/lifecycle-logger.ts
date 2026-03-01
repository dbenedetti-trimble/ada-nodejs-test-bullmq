/**
 * The set of lifecycle events that BullMQ can log.
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
 * A structured log entry emitted at each lifecycle point.
 */
export interface LifecycleLogEntry {
  /** Unix epoch milliseconds at the moment of the log call */
  timestamp: number;
  /** The lifecycle event name */
  event: LifecycleEvent;
  /** Queue name */
  queue: string;
  /** Job ID */
  jobId?: string;
  /** Job name */
  jobName?: string;
  /** Number of attempts made so far */
  attemptsMade?: number;
  /** Processing duration in milliseconds (job:completed, job:failed) */
  duration?: number;
  /** Event-specific extra fields (failedReason, delay, maxAttempts, etc.) */
  data?: Record<string, unknown>;
}

/**
 * User-supplied logger interface for structured job lifecycle logging.
 *
 * Implement this interface and pass it via the `logger` option on Queue or Worker
 * to receive structured log entries at key lifecycle points. When not provided,
 * no logging occurs and there is no overhead beyond a single falsy check.
 */
export interface LifecycleLogger {
  /** Called for routine lifecycle events (job:added, job:active, job:completed, job:delayed, job:rate-limited) */
  debug(entry: LifecycleLogEntry): void;
  /** Called for recoverable anomalies (job:retrying, job:stalled) */
  warn(entry: LifecycleLogEntry): void;
  /** Called for terminal failures (job:failed) */
  error(entry: LifecycleLogEntry): void;
}
