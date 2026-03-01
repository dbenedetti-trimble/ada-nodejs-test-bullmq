'use strict';
import { Packr } from 'msgpackr';
import { ChainableCommander } from 'ioredis';
import { ScriptQueueContext, RedisClient } from '../../interfaces';
import { ErrorCode } from '../../enums';
import { UnrecoverableError } from '../errors';
import { array2obj, isRedisVersionLowerThan } from '../../utils';

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
  let error: Error;
  switch (code) {
    case ErrorCode.JobNotExist:
      error = new Error(`Missing key for job ${jobId}. ${command}`);
      break;
    case ErrorCode.JobLockNotExist:
      error = new Error(`Missing lock for job ${jobId}. ${command}`);
      break;
    case ErrorCode.JobNotInState:
      error = new Error(
        `Job ${jobId} is not in the ${state} state. ${command}`,
      );
      break;
    case ErrorCode.JobPendingChildren:
      error = new Error(`Job ${jobId} has pending dependencies. ${command}`);
      break;
    case ErrorCode.ParentJobNotExist:
      error = new Error(`Missing key for parent job ${parentKey}. ${command}`);
      break;
    case ErrorCode.JobLockMismatch:
      error = new Error(
        `Lock mismatch for job ${jobId}. Cmd ${command} from ${state}`,
      );
      break;
    case ErrorCode.ParentJobCannotBeReplaced:
      error = new Error(
        `The parent job ${parentKey} cannot be replaced. ${command}`,
      );
      break;
    case ErrorCode.JobBelongsToJobScheduler:
      error = new Error(
        `Job ${jobId} belongs to a job scheduler and cannot be removed directly. ${command}`,
      );
      break;
    case ErrorCode.JobHasFailedChildren:
      error = new UnrecoverableError(
        `Cannot complete job ${jobId} because it has at least one failed child. ${command}`,
      );
      break;
    case ErrorCode.SchedulerJobIdCollision:
      error = new Error(
        `Cannot create job scheduler iteration - job ID already exists. ${command}`,
      );
      break;
    case ErrorCode.SchedulerJobSlotsBusy:
      error = new Error(
        `Cannot create job scheduler iteration - current and next time slots already have jobs. ${command}`,
      );
      break;
    default:
      error = new Error(`Unknown code ${code} error for ${jobId}. ${command}`);
  }

  (error as any).code = code;
  return error;
}

export function getKeepJobs(
  shouldRemove: undefined | boolean | number | { count?: number; age?: number },
  workerKeepJobs: undefined | { count?: number; age?: number },
): { count?: number; age?: number } {
  if (typeof shouldRemove === 'undefined') {
    return workerKeepJobs || { count: shouldRemove ? 0 : -1 };
  }

  return typeof shouldRemove === 'object'
    ? shouldRemove
    : typeof shouldRemove === 'number'
      ? { count: shouldRemove }
      : { count: shouldRemove ? 0 : -1 };
}

export async function isJobInList(
  ctx: ScriptContext,
  listKey: string,
  jobId: string,
): Promise<boolean> {
  const client = await ctx.client;
  let result;
  if (isRedisVersionLowerThan(ctx.redisVersion, '6.0.6', ctx.databaseType)) {
    result = await ctx.execCommand(client, 'isJobInList', [listKey, jobId]);
  } else {
    result = await client.lpos(listKey, jobId);
  }
  return Number.isInteger(result);
}

export function raw2NextJobData(raw: any[]) {
  if (raw) {
    const result = [null, raw[1], raw[2], raw[3]];
    if (raw[0]) {
      result[0] = array2obj(raw[0]);
    }
    return result;
  }
  return [];
}
