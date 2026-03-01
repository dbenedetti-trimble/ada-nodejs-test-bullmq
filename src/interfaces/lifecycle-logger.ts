/**
 * Lifecycle event names emitted at key points during job processing.
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
 * Structured log entry passed to LifecycleLogger methods at each lifecycle point.
 */
export interface LifecycleLogEntry {
  /** Unix timestamp (ms) at the point of the log call. */
  timestamp: number;
  /** The lifecycle event that triggered this log entry. */
  event: LifecycleEvent;
  /** The name of the queue. */
  queue: string;
  /** The job's unique identifier. */
  jobId?: string;
  /** The job's name. */
  jobName?: string;
  /** Number of attempts made so far. */
  attemptsMade?: number;
  /** Processing duration in milliseconds (populated for completed and failed events). */
  duration?: number;
  /** Event-specific extra fields (e.g. failedReason, delay, maxAttempts). */
  data?: Record<string, unknown>;
}

/**
 * User-supplied logger interface for structured job lifecycle logging.
 * Implement this interface and pass it as the `logger` option to Queue or Worker.
 */
export interface LifecycleLogger {
  /** Called for routine lifecycle events (job:added, job:active, job:completed, job:delayed, job:rate-limited). */
  debug(entry: LifecycleLogEntry): void;
  /** Called when a job is retrying or stalled. */
  warn(entry: LifecycleLogEntry): void;
  /** Called when a job has permanently failed. */
  error(entry: LifecycleLogEntry): void;
}
