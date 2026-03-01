export type KeysMap = { [index in string]: string };

export class QueueKeys {
  constructor(public readonly prefix = 'bull') {}

  getKeys(name: string): KeysMap {
    const keys: { [index: string]: string } = {};
    [
      '',
      'active',
      'wait',
      'waiting-children',
      'paused',
      'id',
      'delayed',
      'prioritized',
      'stalled-check',
      'completed',
      'failed',
      'stalled',
      'repeat',
      'limiter',
      'meta',
      'events',
      'pc', // priority counter key
      'marker', // marker key
      'de', // deduplication key
    ].forEach(key => {
      keys[key] = this.toKey(name, key);
    });

    return keys;
  }

  toKey(name: string, type: string): string {
    return `${this.getQueueQualifiedName(name)}:${type}`;
  }

  getQueueQualifiedName(name: string): string {
    return `${this.prefix}:${name}`;
  }

  /**
   * Returns the Redis key for the groups index sorted set for a queue.
   * Pattern: prefix:queueName:groups
   */
  toGroupsIndexKey(queueName: string): string {
    return this.toKey(queueName, 'groups');
  }

  /**
   * Returns the Redis key for a specific group's metadata hash.
   * Pattern: prefix:queueName:groups:groupId
   */
  toGroupKey(queueName: string, groupId: string): string {
    return `${this.toGroupsIndexKey(queueName)}:${groupId}`;
  }

  /**
   * Returns the Redis key for a specific group's job membership hash.
   * Pattern: prefix:queueName:groups:groupId:jobs
   */
  toGroupJobsKey(queueName: string, groupId: string): string {
    return `${this.toGroupKey(queueName, groupId)}:jobs`;
  }
}
