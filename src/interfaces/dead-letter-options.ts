import { JobsOptions } from '../types';

export interface DeadLetterQueueOptions {
  /**
   * Target DLQ queue name. Must be a non-empty string.
   *
   * In Redis Cluster mode, the DLQ queue name must use the same hash tag as the
   * source queue (e.g. source: `{payments}`, DLQ: `{payments}-dlq`) to ensure all
   * Lua script keys hash to the same slot. Without a matching hash tag, DLQ operations
   * will throw a CROSSSLOT error in cluster mode.
   */
  queueName: string;
}

export interface DeadLetterMetadata {
  sourceQueue: string;
  originalJobId: string;
  failedReason: string;
  stacktrace: string[];
  attemptsMade: number;
  deadLetteredAt: number;
  originalTimestamp: number;
  originalOpts: JobsOptions;
}

export interface DeadLetterFilter {
  name?: string;
  failedReason?: string;
}
