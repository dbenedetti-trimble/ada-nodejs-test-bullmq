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
  moveToFinishedKeys: (string | undefined)[];

  constructor(private ctx: ScriptContext) {
    const keys = this.ctx.keys;
    this.moveToFinishedKeys = [
      keys.wait,
      keys.active,
      keys.prioritized,
      keys.events,
      keys.stalled,
      keys.limiter,
      keys.delayed,
      keys.paused,
      keys.meta,
      keys.pc,
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
    throw new Error('Not implemented: stub for features pass');
  }

  async extendLocks(
    jobIds: string[],
    tokens: string[],
    duration: number,
  ): Promise<string[]> {
    throw new Error('Not implemented: stub for features pass');
  }

  async moveToActive(
    client: RedisClient,
    token: string,
    name?: string,
  ): Promise<any> {
    throw new Error('Not implemented: stub for features pass');
  }

  async moveToFinished(
    jobId: string,
    args: (string | number | boolean | Buffer)[],
  ) {
    throw new Error('Not implemented: stub for features pass');
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
    throw new Error('Not implemented: stub for features pass');
  }

  moveToCompletedArgs<T = any, R = any, N extends string = string>(
    job: MinimalJob<T, R, N>,
    returnvalue: R,
    removeOnComplete: boolean | number | KeepJobs,
    token: string,
    fetchNext?: boolean,
  ): (string | number | boolean | Buffer)[] {
    throw new Error('Not implemented: stub for features pass');
  }

  moveToFailedArgs<T = any, R = any, N extends string = string>(
    job: MinimalJob<T, R, N>,
    failedReason: string,
    removeOnFailed: boolean | number | KeepJobs,
    token: string,
    fetchNext?: boolean,
    fieldsToUpdate?: Record<string, any>,
  ): (string | number | boolean | Buffer)[] {
    throw new Error('Not implemented: stub for features pass');
  }

  moveToDelayedArgs(
    jobId: string,
    timestamp: number,
    token: string,
    delay: number,
    opts?: MoveToDelayedOpts,
  ): (string | number | Buffer)[] {
    throw new Error('Not implemented: stub for features pass');
  }

  async moveToDelayed(
    jobId: string,
    timestamp: number,
    delay: number,
    token?: string,
    opts?: MoveToDelayedOpts,
  ): Promise<void> {
    throw new Error('Not implemented: stub for features pass');
  }

  moveStalledJobsToWaitArgs(): (string | number)[] {
    throw new Error('Not implemented: stub for features pass');
  }

  async moveStalledJobsToWait(): Promise<string[]> {
    throw new Error('Not implemented: stub for features pass');
  }

  moveJobsToWaitArgs(
    state: FinishedStatus | 'delayed',
    count: number,
    timestamp: number,
  ): (string | number)[] {
    throw new Error('Not implemented: stub for features pass');
  }

  async retryJobs(
    state?: FinishedStatus,
    count?: number,
    timestamp?: number,
  ): Promise<number> {
    throw new Error('Not implemented: stub for features pass');
  }

  async promoteJobs(count?: number): Promise<number> {
    throw new Error('Not implemented: stub for features pass');
  }
}
