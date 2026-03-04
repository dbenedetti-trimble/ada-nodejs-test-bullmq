import { JobsOptions } from '../types';

export interface DeadLetterQueueOptions {
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
