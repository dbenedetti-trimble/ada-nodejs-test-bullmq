'use strict';
import { ChainableCommander } from 'ioredis';
import {
  MinimalJob,
  RedisClient,
  MoveToDelayedOpts,
  WorkerOptions,
} from '../../interfaces';
import {
  FinishedStatus,
  FinishedPropValAttribute,
  KeepJobs,
} from '../../types';
import { objectToFlatArray } from '../../utils';
import {
  ScriptContext,
  finishedErrors,
  getKeepJobs,
  pack,
  raw2NextJobData,
} from './script-utils';

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
    client = client || (await this.ctx.client);
    const args = [
      this.ctx.toKey(jobId) + ':lock',
      this.ctx.keys.stalled,
      token,
      duration,
      jobId,
    ];
    return this.ctx.execCommand(client, 'extendLock', args);
  }

  async extendLocks(
    jobIds: string[],
    tokens: string[],
    duration: number,
  ): Promise<string[]> {
    const client = await this.ctx.client;

    const args = [
      this.ctx.keys.stalled,
      this.ctx.toKey(''),
      pack(tokens),
      pack(jobIds),
      duration,
    ];

    return this.ctx.execCommand(client, 'extendLocks', args);
  }

  async moveToActive(
    client: RedisClient,
    token: string,
    name?: string,
  ): Promise<any> {
    const opts = this.ctx.opts as WorkerOptions;

    const queueKeys = this.ctx.keys;
    const keys = [
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
      queueKeys.marker,
    ];

    const args: (string | number | boolean | Buffer)[] = [
      queueKeys[''],
      Date.now(),
      pack({
        token,
        lockDuration: opts.lockDuration,
        limiter: opts.limiter,
        name,
      }),
    ];

    const result = await this.ctx.execCommand(
      client,
      'moveToActive',
      (<(string | number | boolean | Buffer)[]>keys).concat(args),
    );

    return raw2NextJobData(result);
  }

  async moveToFinished(
    jobId: string,
    args: (string | number | boolean | Buffer)[],
  ): Promise<any> {
    const client = await this.ctx.client;

    const result = await this.ctx.execCommand(client, 'moveToFinished', args);
    if (result < 0) {
      throw finishedErrors({
        code: result,
        jobId,
        command: 'moveToFinished',
        state: 'active',
      });
    } else {
      if (typeof result !== 'undefined') {
        return raw2NextJobData(result);
      }
    }
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
    const queueKeys = this.ctx.keys;
    const opts: WorkerOptions = <WorkerOptions>this.ctx.opts;
    const workerKeepJobs =
      target === 'completed' ? opts.removeOnComplete : opts.removeOnFail;

    const metricsKey = this.ctx.toKey(`metrics:${target}`);

    const keys = this.moveToFinishedKeys;
    keys[10] = queueKeys[target];
    keys[11] = this.ctx.toKey(job.id ?? '');
    keys[12] = metricsKey;
    keys[13] = this.ctx.keys.marker;

    const keepJobs = getKeepJobs(shouldRemove, workerKeepJobs);

    const args = [
      job.id,
      timestamp,
      propVal,
      typeof val === 'undefined' ? 'null' : val,
      target,
      !fetchNext || this.ctx.closing ? 0 : 1,
      queueKeys[''],
      pack({
        token,
        name: opts.name,
        keepJobs,
        limiter: opts.limiter,
        lockDuration: opts.lockDuration,
        attempts: job.opts.attempts,
        maxMetricsSize: opts.metrics?.maxDataPoints
          ? opts.metrics?.maxDataPoints
          : '',
        fpof: !!job.opts?.failParentOnFailure,
        cpof: !!job.opts?.continueParentOnFailure,
        idof: !!job.opts?.ignoreDependencyOnFailure,
        rdof: !!job.opts?.removeDependencyOnFailure,
      }),
      fieldsToUpdate ? pack(objectToFlatArray(fieldsToUpdate)) : void 0,
    ];

    return keys.concat(args);
  }

  protected moveToCompletedArgs<T = any, R = any, N extends string = string>(
    job: MinimalJob<T, R, N>,
    returnvalue: R,
    removeOnComplete: boolean | number | KeepJobs,
    token: string,
    fetchNext?: boolean,
  ): (string | number | boolean | Buffer)[] {
    const timestamp = Date.now();
    return this.moveToFinishedArgs(
      job,
      returnvalue,
      'returnvalue',
      removeOnComplete,
      'completed',
      token,
      timestamp,
      fetchNext,
    );
  }

  protected moveToFailedArgs<T = any, R = any, N extends string = string>(
    job: MinimalJob<T, R, N>,
    failedReason: string,
    removeOnFailed: boolean | number | KeepJobs,
    token: string,
    fetchNext?: boolean,
    fieldsToUpdate?: Record<string, any>,
  ): (string | number | boolean | Buffer)[] {
    const timestamp = Date.now();
    return this.moveToFinishedArgs(
      job,
      failedReason,
      'failedReason',
      removeOnFailed,
      'failed',
      token,
      timestamp,
      fetchNext,
      fieldsToUpdate,
    );
  }

  moveToDelayedArgs(
    jobId: string,
    timestamp: number,
    token: string,
    delay: number,
    opts?: MoveToDelayedOpts,
  ): (string | number | Buffer)[] {
    const queueKeys = this.ctx.keys;

    const keys: (string | number | Buffer)[] = [
      queueKeys.marker,
      queueKeys.active,
      queueKeys.prioritized,
      queueKeys.delayed,
      this.ctx.toKey(jobId),
      queueKeys.events,
      queueKeys.meta,
      queueKeys.stalled,
    ];

    return keys.concat([
      this.ctx.keys[''],
      timestamp,
      jobId,
      token,
      delay,
      opts?.skipAttempt ? '1' : '0',
      opts?.fieldsToUpdate
        ? pack(objectToFlatArray(opts.fieldsToUpdate))
        : void 0,
    ]);
  }

  async moveToDelayed(
    jobId: string,
    timestamp: number,
    delay: number,
    token?: string,
    opts?: MoveToDelayedOpts,
  ): Promise<void> {
    const client = await this.ctx.client;

    const args = this.moveToDelayedArgs(
      jobId,
      timestamp,
      token ?? '0',
      delay,
      opts ?? {},
    );

    const result = await this.ctx.execCommand(client, 'moveToDelayed', args);
    if (result < 0) {
      throw finishedErrors({
        code: result,
        jobId,
        command: 'moveToDelayed',
        state: 'active',
      });
    }
  }

  protected moveStalledJobsToWaitArgs(): (string | number)[] {
    const opts = this.ctx.opts as WorkerOptions;
    const keys: (string | number)[] = [
      this.ctx.keys.stalled,
      this.ctx.keys.wait,
      this.ctx.keys.active,
      this.ctx.keys['stalled-check'],
      this.ctx.keys.meta,
      this.ctx.keys.paused,
      this.ctx.keys.marker,
      this.ctx.keys.events,
    ];
    const args = [
      opts.maxStalledCount,
      this.ctx.toKey(''),
      Date.now(),
      opts.stalledInterval,
    ];

    return keys.concat(args);
  }

  async moveStalledJobsToWait(): Promise<string[]> {
    const client = await this.ctx.client;

    const args = this.moveStalledJobsToWaitArgs();

    return this.ctx.execCommand(client, 'moveStalledJobsToWait', args);
  }

  protected moveJobsToWaitArgs(
    state: FinishedStatus | 'delayed',
    count: number,
    timestamp: number,
  ): (string | number)[] {
    const keys: (string | number)[] = [
      this.ctx.toKey(''),
      this.ctx.keys.events,
      this.ctx.toKey(state),
      this.ctx.toKey('wait'),
      this.ctx.toKey('paused'),
      this.ctx.keys.meta,
      this.ctx.keys.active,
      this.ctx.keys.marker,
    ];

    const args = [count, timestamp, state];

    return keys.concat(args);
  }

  async retryJobs(
    state?: FinishedStatus,
    count?: number,
    timestamp?: number,
  ): Promise<number> {
    const client = await this.ctx.client;

    const args = this.moveJobsToWaitArgs(
      state ?? 'failed',
      count ?? 1000,
      timestamp ?? new Date().getTime(),
    );

    return this.ctx.execCommand(client, 'moveJobsToWait', args);
  }

  async promoteJobs(count?: number): Promise<number> {
    const client = await this.ctx.client;

    const args = this.moveJobsToWaitArgs(
      'delayed',
      count ?? 1000,
      Number.MAX_VALUE,
    );

    return this.ctx.execCommand(client, 'moveJobsToWait', args);
  }
}
