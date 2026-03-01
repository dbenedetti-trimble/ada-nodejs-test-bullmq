'use strict';
import { ChainableCommander } from 'ioredis';
import {
  MinimalJob,
  RedisClient,
  MoveToDelayedOpts,
} from '../../interfaces';
import {
  FinishedStatus,
  FinishedPropValAttribute,
  KeepJobs,
} from '../../types';
import { ScriptContext } from './script-utils';

export class WorkerScripts {
  private moveToFinishedKeys: (string | undefined)[];

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
    throw new Error('stub: not yet implemented');
  }

  async extendLocks(
    jobIds: string[],
    tokens: string[],
    duration: number,
  ): Promise<string[]> {
    throw new Error('stub: not yet implemented');
  }

  async moveToActive(
    client: RedisClient,
    token: string,
    name?: string,
  ): Promise<any> {
    throw new Error('stub: not yet implemented');
  }

  async moveToFinished(
    jobId: string,
    args: (string | number | boolean | Buffer)[],
  ): Promise<any> {
    throw new Error('stub: not yet implemented');
  }

  protected moveToFinishedArgs<T = any, R = any, N extends string = string>(
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
    throw new Error('stub: not yet implemented');
  }

  protected moveToCompletedArgs<T = any, R = any, N extends string = string>(
    job: MinimalJob<T, R, N>,
    returnvalue: R,
    removeOnComplete: boolean | number | KeepJobs,
    token: string,
    fetchNext?: boolean,
  ): (string | number | boolean | Buffer)[] {
    throw new Error('stub: not yet implemented');
  }

  protected moveToFailedArgs<T = any, R = any, N extends string = string>(
    job: MinimalJob<T, R, N>,
    failedReason: string,
    removeOnFailed: boolean | number | KeepJobs,
    token: string,
    fetchNext?: boolean,
    fieldsToUpdate?: Record<string, any>,
  ): (string | number | boolean | Buffer)[] {
    throw new Error('stub: not yet implemented');
  }

  async moveToDelayed(
    jobId: string,
    timestamp: number,
    delay: number,
    token?: string,
    opts?: MoveToDelayedOpts,
  ): Promise<void> {
    throw new Error('stub: not yet implemented');
  }

  moveToDelayedArgs(
    jobId: string,
    timestamp: number,
    token: string,
    delay: number,
    opts?: MoveToDelayedOpts,
  ): (string | number | Buffer)[] {
    throw new Error('stub: not yet implemented');
  }

  async moveStalledJobsToWait(): Promise<string[]> {
    throw new Error('stub: not yet implemented');
  }

  protected moveStalledJobsToWaitArgs(): (string | number)[] {
    throw new Error('stub: not yet implemented');
  }

  async retryJobs(
    state?: FinishedStatus,
    count?: number,
    timestamp?: number,
  ): Promise<number> {
    throw new Error('stub: not yet implemented');
  }

  async promoteJobs(count?: number): Promise<number> {
    throw new Error('stub: not yet implemented');
  }

  protected moveJobsToWaitArgs(
    state: FinishedStatus | 'delayed',
    count: number,
    timestamp: number,
  ): (string | number)[] {
    throw new Error('stub: not yet implemented');
  }
}
