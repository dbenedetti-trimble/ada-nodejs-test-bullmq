import { RedisClient } from '../interfaces';
import { GroupJobEntry, GroupStateResult } from '../interfaces/group-options';
import { GroupStateValue } from '../types/group-state';

/**
 * JobGroup
 *
 * Represents a transactional group of jobs implementing the saga compensation
 * pattern. All jobs in the group either complete successfully or their effects
 * are compensated via dedicated compensation jobs.
 */
export class JobGroup {
  constructor(
    protected readonly client: RedisClient,
    public readonly groupId: string,
    public readonly queueName: string,
    public readonly prefix: string,
  ) {}

  get groupKey(): string {
    return `${this.prefix}:${this.queueName}:groups:${this.groupId}`;
  }

  get groupJobsKey(): string {
    return `${this.groupKey}:jobs`;
  }

  /**
   * Fetches current group state from Redis.
   * Returns null if group does not exist.
   */
  async getState(): Promise<GroupStateResult | null> {
    const raw = await (this.client as any).hgetall(this.groupKey);
    if (!raw || Object.keys(raw).length === 0) {
      return null;
    }
    return {
      id: raw.id,
      name: raw.name,
      state: raw.state as GroupStateValue,
      createdAt: parseInt(raw.createdAt, 10),
      updatedAt: parseInt(raw.updatedAt, 10),
      totalJobs: parseInt(raw.totalJobs, 10),
      completedCount: parseInt(raw.completedCount, 10),
      failedCount: parseInt(raw.failedCount, 10),
      cancelledCount: parseInt(raw.cancelledCount, 10),
    };
  }

  /**
   * Returns all job entries belonging to this group with their current statuses.
   */
  async getJobs(): Promise<GroupJobEntry[]> {
    const raw = await (this.client as any).hgetall(this.groupJobsKey);
    if (!raw) {
      return [];
    }
    return Object.entries(raw).map(([jobKey, status]) => {
      const lastColon = jobKey.lastIndexOf(':');
      const jobId = lastColon >= 0 ? jobKey.slice(lastColon + 1) : jobKey;
      const base = lastColon >= 0 ? jobKey.slice(0, lastColon) : jobKey;
      const secondColon = base.indexOf(':');
      const queueName =
        secondColon >= 0 ? base.slice(secondColon + 1) : base;
      return {
        jobId,
        jobKey,
        status: status as GroupJobEntry['status'],
        queueName,
      };
    });
  }
}
