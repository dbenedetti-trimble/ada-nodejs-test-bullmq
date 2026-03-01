import { ChainableCommander } from 'ioredis';
import { MoveToDelayedOpts, MinimalJob, RedisClient } from '../../interfaces';
import {
  FinishedPropValAttribute,
  FinishedStatus,
  KeepJobs,
} from '../../types';
import { ScriptContext } from './script-utils';

export class WorkerScripts {
  moveToFinishedKeys: (string | undefined)[];

  constructor(private ctx: ScriptContext) {
    const queueKeys = ctx.keys;
    this.moveToFinishedKeys = [
      queueKeys.wait,
      queueKeys.active,
      queueKeys.prioritized,
      queueKeys.events,
      queueKeys.stalled,
      queueKeys.limiter,
      queueKeys.delayed,
      queueKeys.paused,
      queueKeys.meta,
      queueKeys.pc,
      undefined,
      undefined,
      undefined,
      undefined,
    ];
  }

  async extendLock(
    jobId: string,
    token: string,
    duration: number,
    client?: RedisClient | ChainableCommander,
  ): Promise<number> {
    return undefined as any;
  }

  async extendLocks(
    jobIds: string[],
    tokens: string[],
    duration: number,
  ): Promise<string[]> {
    return undefined as any;
  }

  async moveToActive(
    client: RedisClient,
    token: string,
    name?: string,
  ): Promise<any> {
    return undefined as any;
  }

  async moveToFinished(
    jobId: string,
    args: (string | number | boolean | Buffer)[],
  ): Promise<any> {
    return undefined as any;
  }

  moveToFinishedArgs<T = any, R = any, N extends string = string>(
    job: MinimalJob<T, R, N>,
    val: any,
    propVal: FinishedPropValAttribute,
    shouldRemove: undefined | boolean | number | KeepJobs,
    target: FinishedStatus,
    token: string,
    timestamp: number,
    fetchNext?: boolean,
    fieldsToUpdate?: Record<string, any>,
  ): (string | number | boolean | Buffer)[] {
    return [] as any;
  }

  moveToCompletedArgs<T = any, R = any, N extends string = string>(
    job: MinimalJob<T, R, N>,
    returnvalue: R,
    removeOnComplete: boolean | number | KeepJobs,
    token: string,
    fetchNext?: boolean,
  ): (string | number | boolean | Buffer)[] {
    return [] as any;
  }

  moveToFailedArgs<T = any, R = any, N extends string = string>(
    job: MinimalJob<T, R, N>,
    failedReason: string,
    removeOnFailed: boolean | number | KeepJobs,
    token: string,
    fetchNext?: boolean,
    fieldsToUpdate?: Record<string, any>,
  ): (string | number | boolean | Buffer)[] {
    return [] as any;
  }

  moveToDelayedArgs(
    jobId: string,
    timestamp: number,
    token: string,
    delay: number,
    opts?: MoveToDelayedOpts,
  ): (string | number | Buffer)[] {
    return [] as any;
  }

  async moveToDelayed(
    jobId: string,
    timestamp: number,
    delay: number,
    token?: string,
    opts?: MoveToDelayedOpts,
  ): Promise<void> {
    return undefined as any;
  }

  moveStalledJobsToWaitArgs(): (string | number)[] {
    return [] as any;
  }

  async moveStalledJobsToWait(): Promise<string[]> {
    return undefined as any;
  }

  async retryJobs(
    state?: FinishedStatus,
    count?: number,
    timestamp?: number,
  ): Promise<number> {
    return undefined as any;
  }

  async promoteJobs(count?: number): Promise<number> {
    return undefined as any;
  }

  moveJobsToWaitArgs(
    state: FinishedStatus | 'delayed',
    count: number,
    timestamp: number,
  ): (string | number)[] {
    return [] as any;
  }
}
