import { GroupMetadata } from '../interfaces';
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

  static fromRedisHash(rawData: string[]): JobGroup | null {
    if (!rawData || rawData.length === 0) {
      return null;
    }

    const hash: Record<string, string> = {};
    for (let i = 0; i < rawData.length; i += 2) {
      hash[rawData[i]] = rawData[i + 1];
    }

    if (!hash.name || !hash.state) {
      return null;
    }

    return new JobGroup({
      id: hash.id || '',
      name: hash.name,
      state: hash.state as GroupState,
      createdAt: parseInt(hash.createdAt, 10) || 0,
      updatedAt: parseInt(hash.updatedAt, 10) || 0,
      totalJobs: parseInt(hash.totalJobs, 10) || 0,
      completedCount: parseInt(hash.completedCount, 10) || 0,
      failedCount: parseInt(hash.failedCount, 10) || 0,
      cancelledCount: parseInt(hash.cancelledCount, 10) || 0,
      compensation: hash.compensation || '{}',
    });
  }

  toMetadata(): GroupMetadata {
    return {
      id: this.id,
      name: this.name,
      state: this.state,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      totalJobs: this.totalJobs,
      completedCount: this.completedCount,
      failedCount: this.failedCount,
      cancelledCount: this.cancelledCount,
      compensation: '',
    };
  }
}
