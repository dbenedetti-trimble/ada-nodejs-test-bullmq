import { JobsOptions } from '../types';

export interface DeadLetterQueueOptions {
  /**
   * Target DLQ queue name.
   *
   * NOTE (Redis Cluster): Atomicity of DLQ movement requires source and DLQ
   * queue names to hash to the same Redis slot. Use the same hash tag in both
   * names, e.g. '{payments}' and '{payments}-dlq'.
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
