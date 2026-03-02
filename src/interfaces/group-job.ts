import { JobsOptions } from '../types';

export interface CompensationDefinition {
  name: string;
  data?: any;
  opts?: {
    attempts?: number;
    backoff?: { type: string; delay: number };
  };
}

export type CompensationMapping = Record<string, CompensationDefinition>;

export interface GroupJobDefinition {
  name: string;
  queueName: string;
  data?: any;
  prefix?: string;
  opts?: Omit<
    JobsOptions,
    'parent' | 'repeat' | 'debounce' | 'deduplication'
  >;
}
