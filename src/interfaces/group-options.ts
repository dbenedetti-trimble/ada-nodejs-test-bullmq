import { Job } from '../classes/job';
import { GroupState } from '../types/group-state';
import { CompensationMapping, GroupJobDefinition } from './group-job';

export interface GroupOptions {
  name: string;
  jobs: GroupJobDefinition[];
  compensation?: CompensationMapping;
}

export interface GroupNode {
  groupId: string;
  groupName: string;
  jobs: Job[];
}

export interface GroupStateData {
  id: string;
  name: string;
  state: Exclude<GroupState, 'PENDING'>;
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
