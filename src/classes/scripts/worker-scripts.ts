/**
 * Worker domain operations: locks, active, finished, stalled, delayed.
 */

import {
  MinimalJob,
  MoveToDelayedOpts,
  RedisClient,
} from '../../interfaces';
import {
  FinishedPropValAttribute,
  FinishedStatus,
  KeepJobs,
} from '../../types';
import { ChainableCommander } from 'ioredis';
import { ScriptContext } from './script-utils';

export class WorkerScripts {
  moveToFinishedKeys: (string | undefined)[];

  constructor(private ctx: ScriptContext) {
    const queueKeys = this.ctx.keys;

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
    // TODO: implement in features pass
    throw new Error('Not implemented');
  }

  async extendLocks(
    jobIds: string[],
    tokens: string[],
    duration: number,
  ): Promise<string[]> {
    // TODO: implement in features pass
    throw new Error('Not implemented');
  }

  async moveToActive(
    client: RedisClient,
    token: string,
    name?: string,
  ): Promise<any> {
    // TODO: implement in features pass
    throw new Error('Not implemented');
  }

  async moveToFinished(
    jobId: string,
    args: (string | number | boolean | Buffer)[],
  ): Promise<any> {
    // TODO: implement in features pass
    throw new Error('Not implemented');
  }

  public moveToFinishedArgs<
    T = any,
    R = any,
    N extends string = string,
  >(
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
    // TODO: implement in features pass
    throw new Error('Not implemented');
  }

  moveToCompletedArgs<T = any, R = any, N extends string = string>(
    job: MinimalJob<T, R, N>,
    returnvalue: R,
    removeOnComplete: boolean | number | KeepJobs,
    token: string,
    fetchNext?: boolean,
  ): (string | number | boolean | Buffer)[] {
    // TODO: implement in features pass
    throw new Error('Not implemented');
  }

  moveToFailedArgs<T = any, R = any, N extends string = string>(
    job: MinimalJob<T, R, N>,
    failedReason: string,
    removeOnFailed: boolean | number | KeepJobs,
    token: string,
    fetchNext?: boolean,
    fieldsToUpdate?: Record<string, any>,
  ): (string | number | boolean | Buffer)[] {
    // TODO: implement in features pass
    throw new Error('Not implemented');
  }

  moveToDelayedArgs(
    jobId: string,
    timestamp: number,
    token: string,
    delay: number,
    opts?: MoveToDelayedOpts,
  ): (string | number | Buffer)[] {
    // TODO: implement in features pass
    throw new Error('Not implemented');
  }

  async moveToDelayed(
    jobId: string,
    timestamp: number,
    delay: number,
    token?: string,
    opts?: MoveToDelayedOpts,
  ): Promise<void> {
    // TODO: implement in features pass
    throw new Error('Not implemented');
  }

  public moveStalledJobsToWaitArgs(): (string | number)[] {
    // TODO: implement in features pass
    throw new Error('Not implemented');
  }

  async moveStalledJobsToWait(): Promise<string[]> {
    // TODO: implement in features pass
    throw new Error('Not implemented');
  }

  public moveJobsToWaitArgs(
    state: FinishedStatus | 'delayed',
    count: number,
    timestamp: number,
  ): (string | number)[] {
    // TODO: implement in features pass
    throw new Error('Not implemented');
  }

  async retryJobs(
    state?: FinishedStatus,
    count?: number,
    timestamp?: number,
  ): Promise<number> {
    // TODO: implement in features pass
    throw new Error('Not implemented');
  }

  async promoteJobs(count?: number): Promise<number> {
    // TODO: implement in features pass
    throw new Error('Not implemented');
  }
}
