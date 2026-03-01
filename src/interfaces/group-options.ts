import { GroupStateValue } from '../types/group-state';

export interface GroupState {
  id: string;
  name: string;
  state: Exclude<GroupStateValue, 'PENDING'>;
  createdAt: number;
  updatedAt: number;
  totalJobs: number;
  completedCount: number;
  failedCount: number;
  cancelledCount: number;
}
