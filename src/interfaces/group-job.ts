import { JobsOptions } from '../types';

export interface GroupJobDefinition {
  name: string;
  queueName: string;
  data?: any;
  opts?: Omit<JobsOptions, 'group' | 'parent'>;
}

export interface CompensationJobDefinition {
  name: string;
  data?: any;
  opts?: Pick<JobsOptions, 'attempts' | 'backoff'>;
}

export interface CompensationMapping {
  [jobName: string]: CompensationJobDefinition;
}
