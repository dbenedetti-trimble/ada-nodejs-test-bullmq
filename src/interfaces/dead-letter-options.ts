import { JobsOptions } from '../types';

/**
 * Configuration for the dead letter queue on a Worker.
 */
export interface DeadLetterQueueOptions {
  /**
   * The name of the target DLQ queue. Must be a non-empty string.
   * The DLQ queue uses the same Redis connection and prefix as the source queue.
   */
  queueName: string;
}

/**
 * Metadata attached to every job moved to a dead letter queue.
 * Stored as the `_dlqMeta` field within the DLQ job's data.
 */
export interface DeadLetterMetadata {
  /** Original source queue name. */
  sourceQueue: string;

  /** Job ID in the source queue. */
  originalJobId: string;

  /** Error message from the final failed attempt. */
  failedReason: string;

  /** Stacktraces collected across all attempts. */
  stacktrace: string[];

  /** Total number of attempts made before the job was dead-lettered. */
  attemptsMade: number;

  /** Timestamp (ms) when the job was moved to the DLQ. */
  deadLetteredAt: number;

  /** Original job creation timestamp. */
  originalTimestamp: number;

  /** Original job options (attempts, backoff, delay, priority, etc.). */
  originalOpts: JobsOptions;
}

/**
 * Optional filter for bulk DLQ replay and purge operations.
 * All specified fields must match (AND semantics).
 */
export interface DeadLetterFilter {
  /** Exact match on the original job name. */
  name?: string;

  /** Case-insensitive substring match on `_dlqMeta.failedReason`. */
  failedReason?: string;
}
