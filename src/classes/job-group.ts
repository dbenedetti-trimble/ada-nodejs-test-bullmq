import { GroupJobEntry, GroupStateData } from '../interfaces/group-options';
import { GroupState } from '../types/group-state';

/**
 * JobGroup
 *
 * Provides static utility methods for parsing Redis HGETALL flat arrays
 * into typed GroupStateData and GroupJobEntry[] objects.
 */
export class JobGroup {
  /**
   * Parses the flat HGETALL result array from Redis into a GroupStateData object.
   * The flat array alternates field names and values: [field, value, field, value, ...]
   */
  static fromRaw(groupId: string, raw: string[]): GroupStateData {
    const obj: Record<string, string> = {};
    for (let i = 0; i < raw.length; i += 2) {
      obj[raw[i]] = raw[i + 1];
    }

    return {
      id: groupId,
      name: obj.name || '',
      state: (obj.state || 'ACTIVE') as Exclude<GroupState, 'PENDING'>,
      createdAt: parseInt(obj.createdAt, 10) || 0,
      updatedAt: parseInt(obj.updatedAt, 10) || 0,
      totalJobs: parseInt(obj.totalJobs, 10) || 0,
      completedCount: parseInt(obj.completedCount, 10) || 0,
      failedCount: parseInt(obj.failedCount, 10) || 0,
      cancelledCount: parseInt(obj.cancelledCount, 10) || 0,
    };
  }

  /**
   * Parses the HGETALL result of the group jobs hash into GroupJobEntry array.
   * Each entry in the flat array is: fullJobKey, status, fullJobKey, status, ...
   * fullJobKey format: prefix:queueName:jobId
   */
  static jobsFromRaw(raw: string[], prefix: string): GroupJobEntry[] {
    const entries: GroupJobEntry[] = [];
    for (let i = 0; i < raw.length; i += 2) {
      const fullJobKey = raw[i];
      const status = raw[i + 1] as GroupJobEntry['status'];

      // Parse {prefix}:{queueName}:{jobId} — jobId is the last segment
      const lastColon = fullJobKey.lastIndexOf(':');
      const jobId = fullJobKey.substring(lastColon + 1);
      const queueBase = fullJobKey.substring(0, lastColon);

      // queueBase = {prefix}:{queueName}, extract queueName by removing prefix
      const prefixWithColon = `${prefix}:`;
      const queueName = queueBase.startsWith(prefixWithColon)
        ? queueBase.substring(prefixWithColon.length)
        : queueBase;

      entries.push({
        jobId,
        jobKey: fullJobKey,
        status,
        queueName,
      });
    }
    return entries;
  }
}
