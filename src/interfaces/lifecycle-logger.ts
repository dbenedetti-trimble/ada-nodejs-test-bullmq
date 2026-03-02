/**
 * Union of lifecycle event names emitted at key job processing points.
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
 *
 * Every entry includes the timestamp, event name, and queue name.
 * Additional fields are populated depending on the event type.
 */
export interface LifecycleLogEntry {
  /**
   * Millisecond timestamp (`Date.now()`) at the point of the log call.
   */
  timestamp: number;

  /**
   * The lifecycle event that triggered this log entry.
   */
  event: LifecycleEvent;

  /**
   * Queue name string.
   */
  queue: string;

  /**
   * Job identifier, when available.
   */
  jobId?: string;

  /**
   * Job name, when available.
   */
  jobName?: string;

  /**
   * Number of attempts made so far.
   */
  attemptsMade?: number;

  /**
   * Processing duration in milliseconds. Populated for `job:completed`
   * and `job:failed` events.
   */
  duration?: number;

  /**
   * Event-specific metadata (e.g., `failedReason`, `maxAttempts`, `delay`).
   */
  data?: Record<string, unknown>;
}

/**
 * Logger contract for structured job lifecycle logging.
 *
 * Implement this interface and pass it as the `logger` option on
 * `QueueBaseOptions` to receive structured log entries at key
 * job lifecycle points.
 */
export interface LifecycleLogger {
  /**
   * Called for routine lifecycle events (added, active, completed, delayed, rate-limited).
   */
  debug(entry: LifecycleLogEntry): void;

  /**
   * Called for events that indicate potential issues (retrying, stalled).
   */
  warn(entry: LifecycleLogEntry): void;

  /**
   * Called when a job fails permanently.
   */
  error(entry: LifecycleLogEntry): void;
}
