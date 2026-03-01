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

export type CompensationMapping = Record<string, CompensationJobDefinition>;
