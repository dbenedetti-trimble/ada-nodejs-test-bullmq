import { GroupJobDefinition, CompensationMapping } from './group-job';
import { GroupStateValue } from '../types/group-state';

export interface GroupOptions {
  name: string;
  jobs: GroupJobDefinition[];
  compensation?: CompensationMapping;
}

export interface GroupStateResult {
  id: string;
  name: string;
  state: GroupStateValue;
  createdAt: number;
  updatedAt: number;
  totalJobs: number;
  completedCount: number;
  failedCount: number;
  cancelledCount: number;
}

export interface GroupJobEntry {
  jobId: string;
  jobKey: string;
  status: 'pending' | 'active' | 'completed' | 'failed' | 'cancelled';
  queueName: string;
}

export interface GroupMembershipOpts {
  id: string;
  name: string;
  queueName: string;
}
