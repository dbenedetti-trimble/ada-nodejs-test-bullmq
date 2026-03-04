/**
 * Shared utilities for domain script modules.
 */

import { Packr } from 'msgpackr';
import { KeysMap } from '../queue-keys';
import {
  QueueBaseOptions,
  RedisClient,
} from '../../interfaces';
import { ErrorCode } from '../../enums';
import { KeepJobs } from '../../types';
import { array2obj, isRedisVersionLowerThan } from '../../utils';
import { ChainableCommander } from 'ioredis';
import { UnrecoverableError } from '../errors';
import { DatabaseType } from '../../types/database-type';

const packer = new Packr({
  useRecords: false,
  encodeUndefinedAsNil: true,
});

export const pack = packer.pack;

export interface ScriptContext {
  readonly keys: KeysMap;
  readonly toKey: (type: string) => string;
  readonly opts: QueueBaseOptions;
  readonly closing: Promise<void> | undefined;
  readonly client: Promise<RedisClient>;
  readonly redisVersion: string;
  readonly databaseType: DatabaseType;
  readonly version: string;
  execCommand(
    client: RedisClient | ChainableCommander,
    commandName: string,
    args: any[],
  ): any;
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
  // TODO: implement in features pass
  throw new Error('Not implemented');
}

export function getKeepJobs(
  shouldRemove: undefined | boolean | number | KeepJobs,
  workerKeepJobs: undefined | KeepJobs,
): KeepJobs | { count: number } {
  // TODO: implement in features pass
  throw new Error('Not implemented');
}

export function raw2NextJobData(raw: any[]): any[] {
  // TODO: implement in features pass
  return [];
}

export async function isJobInList(
  ctx: ScriptContext,
  listKey: string,
  jobId: string,
): Promise<boolean> {
  // TODO: implement in features pass
  throw new Error('Not implemented');
}
