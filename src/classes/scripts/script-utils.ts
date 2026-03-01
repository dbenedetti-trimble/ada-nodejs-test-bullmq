import { Packr } from 'msgpackr';
import { ChainableCommander } from 'ioredis';
import { RedisClient } from '../../interfaces/connection';
import { QueueBaseOptions } from '../../interfaces/queue-options';
import { KeysMap } from '../queue-keys';
import { DatabaseType } from '../../types/database-type';
import { KeepJobs } from '../../types';
import { ErrorCode } from '../../enums';
import { UnrecoverableError } from '../errors';
import { isRedisVersionLowerThan } from '../../utils';

const packer = new Packr({
  useRecords: false,
  encodeUndefinedAsNil: true,
});

export const pack = packer.pack.bind(packer);

export interface ScriptContext {
  readonly opts: QueueBaseOptions;
  readonly toKey: (type: string) => string;
  readonly keys: KeysMap;
  readonly closing: Promise<void> | undefined;
  get client(): Promise<RedisClient>;
  get redisVersion(): string;
  get databaseType(): DatabaseType;
  execCommand(
    client: RedisClient | ChainableCommander,
    commandName: string,
    args: any[],
  ): any;
}

export function raw2NextJobData(raw: any[]) {
  // stub — implemented in features pass
  return undefined as any;
}

export function finishedErrors({
  code,
  jobId,
  parentKey,
  command,
  state,
}: {
  code: number;
  jobId?: string;
  parentKey?: string;
  command: string;
  state?: string;
}): Error {
  // stub — implemented in features pass
  return new Error(`finishedErrors stub: code=${code} ${command}`);
}

export function getKeepJobs(
  shouldRemove: undefined | boolean | number | KeepJobs,
  workerKeepJobs: undefined | KeepJobs,
): KeepJobs {
  // stub — implemented in features pass
  return { count: -1 };
}

export async function isJobInList(
  ctx: ScriptContext,
  listKey: string,
  jobId: string,
): Promise<boolean> {
  // stub — implemented in features pass
  return false;
}

// Re-export to suppress unused import warnings during scaffold
export { ErrorCode, UnrecoverableError, isRedisVersionLowerThan };
