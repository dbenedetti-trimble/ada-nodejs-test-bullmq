import { GroupState, GroupJobStatus } from '../types/group-state';
import { CompensationMapping, GroupJobDefinition } from './group-job';

export interface GroupOptions {
  name: string;
  jobs: GroupJobDefinition[];
  compensation?: CompensationMapping;
}

export interface GroupNode {
  groupId: string;
  jobs: any[];
}

export interface GroupMetadata {
  id: string;
  name: string;
  state: GroupState;
  createdAt: number;
  updatedAt: number;
  totalJobs: number;
  completedCount: number;
  failedCount: number;
  cancelledCount: number;
  compensation: string;
}

export interface GroupJobInfo {
  jobId: string;
  jobKey: string;
  status: GroupJobStatus;
  queueName: string;
}
