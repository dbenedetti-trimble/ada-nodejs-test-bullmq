/**
 * Union of all lifecycle event names that can be logged.
 *
 * Each value corresponds to a distinct point in a job's lifecycle where
 * the logger may be invoked.
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
 * All fields are populated where applicable for the event type. Optional
 * fields are omitted when not relevant to the event.
 */
export interface LifecycleLogEntry {
  /**
   * Unix timestamp (milliseconds) at the moment of the log call.
   */
  timestamp: number;

  /**
   * The lifecycle event that triggered this log entry.
   */
  event: LifecycleEvent;

  /**
   * The name of the queue the job belongs to.
   */
  queue: string;

  /**
   * The unique identifier of the job, if available.
   */
  jobId?: string;

  /**
   * The name of the job, if available.
   */
  jobName?: string;

  /**
   * The number of processing attempts made so far for this job.
   */
  attemptsMade?: number;

  /**
   * Duration of processing in milliseconds. Populated for
   * `job:completed` and `job:failed` events.
   */
  duration?: number;

  /**
   * Event-specific extra metadata. For example, `failedReason` on
   * `job:failed`, or `delay` and `maxAttempts` on `job:retrying`.
   */
  data?: Record<string, unknown>;
}

/**
 * Logger interface for structured job lifecycle events.
 *
 * Implementations are provided by the user and injected via the
 * `logger` option on `QueueBaseOptions`. BullMQ defines only the
 * contract; no default implementation is provided.
 */
export interface LifecycleLogger {
  /**
   * Called for routine lifecycle events such as `job:added`,
   * `job:active`, `job:completed`, `job:delayed`, and `job:rate-limited`.
   *
   * @param entry - The structured log entry for the event.
   */
  debug(entry: LifecycleLogEntry): void;

  /**
   * Called for events that warrant operator attention, such as
   * `job:retrying` and `job:stalled`.
   *
   * @param entry - The structured log entry for the event.
   */
  warn(entry: LifecycleLogEntry): void;

  /**
   * Called when a job fails permanently (no more retries), i.e.,
   * `job:failed`.
   *
   * @param entry - The structured log entry for the event.
   */
  error(entry: LifecycleLogEntry): void;
}
