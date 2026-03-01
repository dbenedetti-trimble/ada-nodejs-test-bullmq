import { ChainableCommander } from 'ioredis';
import {
  MinimalJob,
  RedisClient,
  MoveToDelayedOpts,
} from '../../interfaces';
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
    _jobId: string,
    _token: string,
    _duration: number,
    _client?: RedisClient | ChainableCommander,
  ): Promise<number> {
    throw new Error('stub');
  }

  async extendLocks(
    _jobIds: string[],
    _tokens: string[],
    _duration: number,
  ): Promise<string[]> {
    throw new Error('stub');
  }

  async moveToActive(
    _client: RedisClient,
    _token: string,
    _name?: string,
  ): Promise<any> {
    throw new Error('stub');
  }

  protected moveToFinishedArgs<T = any, R = any, N extends string = string>(
    _job: MinimalJob<T, R, N>,
    _val: any,
    _propVal: FinishedPropValAttribute,
    _shouldRemove: undefined | boolean | number | KeepJobs,
    _target: FinishedStatus,
    _token: string,
    _timestamp: number,
    _fetchNext?: boolean,
    _fieldsToUpdate?: Record<string, any>,
  ): (string | number | boolean | Buffer)[] {
    throw new Error('stub');
  }

  moveToCompletedArgs<T = any, R = any, N extends string = string>(
    _job: MinimalJob<T, R, N>,
    _returnvalue: R,
    _removeOnComplete: boolean | number | KeepJobs,
    _token: string,
    _fetchNext?: boolean,
  ): (string | number | boolean | Buffer)[] {
    throw new Error('stub');
  }

  moveToFailedArgs<T = any, R = any, N extends string = string>(
    _job: MinimalJob<T, R, N>,
    _failedReason: string,
    _removeOnFailed: boolean | number | KeepJobs,
    _token: string,
    _fetchNext?: boolean,
    _fieldsToUpdate?: Record<string, any>,
  ): (string | number | boolean | Buffer)[] {
    throw new Error('stub');
  }

  async moveToFinished(
    _jobId: string,
    _args: (string | number | boolean | Buffer)[],
  ): Promise<any> {
    throw new Error('stub');
  }

  moveToDelayedArgs(
    _jobId: string,
    _timestamp: number,
    _token: string,
    _delay: number,
    _opts?: MoveToDelayedOpts,
  ): (string | number | Buffer)[] {
    throw new Error('stub');
  }

  async moveToDelayed(
    _jobId: string,
    _timestamp: number,
    _delay: number,
    _token?: string,
    _opts?: MoveToDelayedOpts,
  ): Promise<void> {
    throw new Error('stub');
  }

  protected moveStalledJobsToWaitArgs(): (string | number)[] {
    throw new Error('stub');
  }

  async moveStalledJobsToWait(): Promise<string[]> {
    throw new Error('stub');
  }

  protected moveJobsToWaitArgs(
    _state: FinishedStatus | 'delayed',
    _count: number,
    _timestamp: number,
  ): (string | number)[] {
    throw new Error('stub');
  }

  async retryJobs(
    _state?: FinishedStatus,
    _count?: number,
    _timestamp?: number,
  ): Promise<number> {
    throw new Error('stub');
  }

  async promoteJobs(_count?: number): Promise<number> {
    throw new Error('stub');
  }
}
