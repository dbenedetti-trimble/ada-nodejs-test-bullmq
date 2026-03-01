import { RedisClient } from '../interfaces';
import { GroupJobEntry, GroupStateResult } from '../interfaces/group-options';

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
    // TODO(features): implement via getGroupState-1.lua
    throw new Error('Not implemented');
  }

  /**
   * Returns all job entries belonging to this group with their current statuses.
   */
  async getJobs(): Promise<GroupJobEntry[]> {
    // TODO(features): implement via HGETALL on groupJobsKey
    throw new Error('Not implemented');
  }
}
