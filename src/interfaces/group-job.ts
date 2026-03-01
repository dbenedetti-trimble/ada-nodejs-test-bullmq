import { JobsOptions } from '../types';

export interface GroupJobDefinition {
  name: string;
  queueName: string;
  data: any;
  opts?: Omit<JobsOptions, 'parent'>;
}

export interface CompensationJobDefinition {
  name: string;
  data: any;
  opts?: Pick<JobsOptions, 'attempts' | 'backoff'>;
}

export interface GroupOptions {
  /** Display name for the group. */
  name: string;
  /** The queue namespace that owns the group metadata. */
  queueName: string;
  jobs: GroupJobDefinition[];
  compensation?: Record<string, CompensationJobDefinition>;
}

export interface GroupNode {
  groupId: string;
  groupName: string;
  jobs: any[];
}

export interface GroupJobEntry {
  jobId: string;
  jobKey: string;
  status: 'pending' | 'active' | 'completed' | 'failed' | 'cancelled';
  queueName: string;
}
