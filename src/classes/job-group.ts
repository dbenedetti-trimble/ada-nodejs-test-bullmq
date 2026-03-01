import { GroupJobEntry, GroupStateData } from '../interfaces/group-options';
import { ScriptQueueContext } from '../interfaces';

/**
 * JobGroup
 *
 * Represents a transactional saga group of independent jobs.
 * Provides query access to group state and membership stored in Redis.
 *
 * This class is used internally by Queue methods (getGroupState, getGroupJobs, cancelGroup)
 * and exposes a typed view over the Redis hash data.
 */
export class JobGroup {
  constructor(
    public readonly groupId: string,
    public readonly queueName: string,
    protected readonly queue: ScriptQueueContext,
  ) {}

  /**
   * Returns the current group state metadata from Redis.
   * Returns null if the group does not exist.
   *
   * TODO(features): delegate to Scripts.getGroupState()
   */
  async getState(): Promise<GroupStateData | null> {
    throw new Error('Not implemented');
  }

  /**
   * Returns all member jobs with their current statuses in this group.
   *
   * TODO(features): delegate to Scripts.getGroupJobs() or direct HGETALL
   */
  async getJobs(): Promise<GroupJobEntry[]> {
    throw new Error('Not implemented');
  }

  /**
   * Parses the flat HGETALL result array from Redis into a GroupStateData object.
   *
   * TODO(features): implement field mapping
   */
  static fromRaw(
    groupId: string,
    raw: string[],
  ): GroupStateData {
    throw new Error('Not implemented');
  }

  /**
   * Parses the HGETALL result of the group jobs hash into GroupJobEntry array.
   *
   * TODO(features): implement jobKey parsing (prefix:queueName:jobId)
   */
  static jobsFromRaw(
    raw: string[],
    prefix: string,
  ): GroupJobEntry[] {
    throw new Error('Not implemented');
  }
}
