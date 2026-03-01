'use strict';
import { Packr } from 'msgpackr';
import { ChainableCommander } from 'ioredis';
import { ScriptQueueContext, RedisClient } from '../../interfaces';
import { ErrorCode } from '../../enums';
import { UnrecoverableError } from '../errors';
import { array2obj } from '../../utils';

const packer = new Packr({
  useRecords: false,
  encodeUndefinedAsNil: true,
});

export const pack = packer.pack;

export interface ScriptContext extends ScriptQueueContext {
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
  throw new Error('stub: not yet implemented');
}

export function getKeepJobs(
  shouldRemove: undefined | boolean | number | { count?: number; age?: number },
  workerKeepJobs: undefined | { count?: number; age?: number },
): { count?: number; age?: number } {
  throw new Error('stub: not yet implemented');
}

export async function isJobInList(
  ctx: ScriptContext,
  listKey: string,
  jobId: string,
): Promise<boolean> {
  throw new Error('stub: not yet implemented');
}

export function raw2NextJobData(raw: any[]) {
  throw new Error('stub: not yet implemented');
}
