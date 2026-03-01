import { GroupState, GroupJobEntry } from '../interfaces';
import { RedisClient } from '../interfaces';

/**
 * JobGroup
 *
 * Represents a transactional job group (saga) in BullMQ.
 * Encapsulates group metadata read from Redis.
 */
export class JobGroup {
  constructor(
    public readonly groupId: string,
    public readonly queueName: string,
    public readonly prefix: string,
  ) {}

  /**
   * Returns the Redis key for the group metadata hash.
   */
  toGroupKey(): string {
    return `${this.prefix}:${this.queueName}:groups:${this.groupId}`;
  }

  /**
   * Returns the Redis key for the group job membership hash.
   */
  toJobsKey(): string {
    return `${this.toGroupKey()}:jobs`;
  }

  /**
   * Fetch the current group state from Redis.
   * Returns null if the group does not exist.
   */
  async getState(_client: RedisClient): Promise<GroupState | null> {
    // TODO(features): implement HGETALL-based state fetch via getGroupState-1.lua
    throw new Error('Not implemented');
  }

  /**
   * Fetch all job membership entries from Redis.
   */
  async getJobs(_client: RedisClient): Promise<GroupJobEntry[]> {
    // TODO(features): implement HGETALL on group jobs key and parse entries
    throw new Error('Not implemented');
  }
}
