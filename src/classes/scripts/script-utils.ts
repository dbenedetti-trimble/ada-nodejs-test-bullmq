import { Packr } from 'msgpackr';
import { ChainableCommander } from 'ioredis';
import { ScriptQueueContext } from '../../interfaces/script-queue-context';
import { RedisClient } from '../../interfaces/connection';
import { KeepJobs } from '../../types';

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

export function raw2NextJobData(_raw: any[]): any[] {
  throw new Error('stub: raw2NextJobData not yet implemented');
}

export function finishedErrors(_params: {
  code: number;
  jobId?: string;
  parentKey?: string;
  command: string;
  state?: string;
}): Error {
  throw new Error('stub: finishedErrors not yet implemented');
}

export function getKeepJobs(
  _shouldRemove: undefined | boolean | number | KeepJobs,
  _workerKeepJobs: undefined | KeepJobs,
): KeepJobs {
  throw new Error('stub: getKeepJobs not yet implemented');
}

export async function isJobInList(
  _ctx: ScriptContext,
  _listKey: string,
  _jobId: string,
): Promise<boolean> {
  throw new Error('stub: isJobInList not yet implemented');
}
