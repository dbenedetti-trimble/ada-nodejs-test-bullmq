import { JobsOptions } from '../types';

export interface DeadLetterQueueOptions {
  /**
   * Target DLQ queue name. Must be a non-empty string.
   * The DLQ queue shares the same Redis connection and prefix as the source queue.
   * In Redis Cluster mode, use the same hash tag as the source queue for atomicity.
   */
  queueName: string;
}

export interface DeadLetterMetadata {
  /** Original queue name */
  sourceQueue: string;
  /** Job ID in the source queue */
  originalJobId: string;
  /** Error message from the final failure */
  failedReason: string;
  /** Full stacktrace array from all attempts */
  stacktrace: string[];
  /** Total attempts before DLQ */
  attemptsMade: number;
  /** Timestamp of DLQ movement (ms) */
  deadLetteredAt: number;
  /** When the job was originally created */
  originalTimestamp: number;
  /** Original job options (attempts, backoff, delay, etc.) */
  originalOpts: JobsOptions;
}

export interface DeadLetterFilter {
  /** Filter by original job name (exact match) */
  name?: string;
  /** Filter by substring in failure reason (case-insensitive) */
  failedReason?: string;
}
