/**
 * Union type of all lifecycle events that can be logged.
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
 * Structured log entry produced at each job lifecycle point.
 */
export interface LifecycleLogEntry {
  /**
   * Unix timestamp in milliseconds at the point of the log call.
   */
  timestamp: number;

  /**
   * The lifecycle event identifier.
   */
  event: LifecycleEvent;

  /**
   * The name of the queue where the event occurred.
   */
  queue: string;

  /**
   * The job id.
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
   * Duration in milliseconds from when processing started to the log call.
   * Populated for `job:completed` and `job:failed` events.
   */
  duration?: number;

  /**
   * Event-specific additional data (e.g., failedReason, delay, maxAttempts).
   */
  data?: Record<string, unknown>;
}

/**
 * Interface for a structured lifecycle logger that can be injected into
 * Queue and Worker options. BullMQ provides only this interface contract;
 * the implementation is supplied by the user.
 */
export interface LifecycleLogger {
  /**
   * Log a routine lifecycle event (e.g., job added, active, completed).
   */
  debug(entry: LifecycleLogEntry): void;

  /**
   * Log a notable lifecycle event (e.g., retries, stalls).
   */
  warn(entry: LifecycleLogEntry): void;

  /**
   * Log a failure lifecycle event.
   */
  error(entry: LifecycleLogEntry): void;
}
