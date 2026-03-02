import {
  GroupMetadata,
  GroupJobInfo,
  GroupOptions,
  GroupNode,
  RedisClient,
} from '../interfaces';
import { GroupState } from '../types';

export class JobGroup {
  readonly id: string;
  readonly name: string;
  state: GroupState;
  readonly createdAt: number;
  updatedAt: number;
  readonly totalJobs: number;
  completedCount: number;
  failedCount: number;
  cancelledCount: number;

  constructor(metadata: GroupMetadata) {
    this.id = metadata.id;
    this.name = metadata.name;
    this.state = metadata.state;
    this.createdAt = metadata.createdAt;
    this.updatedAt = metadata.updatedAt;
    this.totalJobs = metadata.totalJobs;
    this.completedCount = metadata.completedCount;
    this.failedCount = metadata.failedCount;
    this.cancelledCount = metadata.cancelledCount;
  }

  static fromRedisHash(_rawData: Record<string, string>): JobGroup | null {
    // TODO: implement in features pass
    return null;
  }

  toMetadata(): GroupMetadata {
    // TODO: implement in features pass
    return {} as GroupMetadata;
  }
}
