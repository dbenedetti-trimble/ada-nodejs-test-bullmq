/**
 * Includes all the scripts needed by the queue and jobs.
 */

'use strict';
import { Packr } from 'msgpackr';

const packer = new Packr({
  useRecords: false,
  encodeUndefinedAsNil: true,
});

const pack = packer.pack;

import {
  JobJson,
  JobJsonRaw,
  MinimalJob,
  MoveToWaitingChildrenOpts,
  ParentKeyOpts,
  RedisClient,
  WorkerOptions,
  MoveToDelayedOpts,
  RepeatableOptions,
  RetryJobOpts,
  RetryOptions,
  ScriptQueueContext,
} from '../interfaces';
import {
  JobsOptions,
  JobState,
  JobType,
  FinishedStatus,
  FinishedPropValAttribute,
  KeepJobs,
  RedisJobOptions,
  JobProgress,
} from '../types';
import { ErrorCode } from '../enums';
import {
  array2obj,
  getParentKey,
  isRedisVersionLowerThan,
  objectToFlatArray,
} from '../utils';
import { ChainableCommander } from 'ioredis';
import { version as packageVersion } from '../version';
import { UnrecoverableError } from './errors';
import { QueueKeys } from './queue-keys';
export type JobData = [JobJsonRaw | number, string?];

export class Scripts {
  protected version = packageVersion;

  moveToFinishedKeys: (string | undefined)[];

  constructor(protected queue: ScriptQueueContext) {
    const queueKeys = this.queue.keys;

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

  public execCommand(
    client: RedisClient | ChainableCommander,
    commandName: string,
    args: any[],
  ) {
    const commandNameWithVersion = `${commandName}:${this.version}`;
    return (<any>client)[commandNameWithVersion](args);
  }

  async isJobInList(listKey: string, jobId: string): Promise<boolean> {
    const client = await this.queue.client;
    let result;
    if (
      isRedisVersionLowerThan(
        this.queue.redisVersion,
        '6.0.6',
        this.queue.databaseType,
      )
    ) {
      result = await this.execCommand(client, 'isJobInList', [listKey, jobId]);
    } else {
      result = await client.lpos(listKey, jobId);
    }
    return Number.isInteger(result);
  }

  protected addDelayedJobArgs(
    job: JobJson,
    encodedOpts: any,
    args: (string | number | Record<string, any>)[],
  ): (string | Buffer)[] {
    const queueKeys = this.queue.keys;
    const keys: (string | Buffer)[] = [
      queueKeys.marker,
      queueKeys.meta,
      queueKeys.id,
      queueKeys.delayed,
      queueKeys.completed,
      queueKeys.events,
    ];

    keys.push(pack(args), job.data, encodedOpts);

    return keys;
  }

  protected addDelayedJob(
    client: RedisClient,
    job: JobJson,
    encodedOpts: any,
    args: (string | number | Record<string, any>)[],
  ): Promise<string | number> {
    const argsList = this.addDelayedJobArgs(job, encodedOpts, args);

    return this.execCommand(client, 'addDelayedJob', argsList);
  }

  protected addPrioritizedJobArgs(
    job: JobJson,
    encodedOpts: any,
    args: (string | number | Record<string, any>)[],
  ): (string | Buffer)[] {
    const queueKeys = this.queue.keys;
    const keys: (string | Buffer)[] = [
      queueKeys.marker,
      queueKeys.meta,
      queueKeys.id,
      queueKeys.prioritized,
      queueKeys.delayed,
      queueKeys.completed,
      queueKeys.active,
      queueKeys.events,
      queueKeys.pc,
    ];

    keys.push(pack(args), job.data, encodedOpts);

    return keys;
  }

  protected addPrioritizedJob(
    client: RedisClient,
    job: JobJson,
    encodedOpts: any,
    args: (string | number | Record<string, any>)[],
  ): Promise<string | number> {
    const argsList = this.addPrioritizedJobArgs(job, encodedOpts, args);

    return this.execCommand(client, 'addPrioritizedJob', argsList);
  }

  protected addParentJobArgs(
    job: JobJson,
    encodedOpts: any,
    args: (string | number | Record<string, any>)[],
  ): (string | Buffer)[] {
    const queueKeys = this.queue.keys;
    const keys: (string | Buffer)[] = [
      queueKeys.meta,
      queueKeys.id,
      queueKeys.delayed,
      queueKeys['waiting-children'],
      queueKeys.completed,
      queueKeys.events,
    ];

    keys.push(pack(args), job.data, encodedOpts);

    return keys;
  }

  protected addParentJob(
    client: RedisClient,
    job: JobJson,
    encodedOpts: any,
    args: (string | number | Record<string, any>)[],
  ): Promise<string | number> {
    const argsList = this.addParentJobArgs(job, encodedOpts, args);

    return this.execCommand(client, 'addParentJob', argsList);
  }

  protected addStandardJobArgs(
    job: JobJson,
    encodedOpts: any,
    args: (string | number | Record<string, any>)[],
  ): (string | Buffer)[] {
    const queueKeys = this.queue.keys;
    const keys: (string | Buffer)[] = [
      queueKeys.wait,
      queueKeys.paused,
      queueKeys.meta,
      queueKeys.id,
      queueKeys.completed,
      queueKeys.delayed,
      queueKeys.active,
      queueKeys.events,
      queueKeys.marker,
    ];

    keys.push(pack(args), job.data, encodedOpts);

    return keys;
  }

  protected addStandardJob(
    client: RedisClient,
    job: JobJson,
    encodedOpts: any,
    args: (string | number | Record<string, any>)[],
  ): Promise<string | number> {
    const argsList = this.addStandardJobArgs(job, encodedOpts, args);

    return this.execCommand(client, 'addStandardJob', argsList);
  }

  async addJob(
    client: RedisClient,
    job: JobJson,
    opts: RedisJobOptions,
    jobId: string,
    parentKeyOpts: ParentKeyOpts = {},
  ): Promise<string> {
    const queueKeys = this.queue.keys;

    const parent: Record<string, any> = job.parent;

    const args = [
      queueKeys[''],
      typeof jobId !== 'undefined' ? jobId : '',
      job.name,
      job.timestamp,
      job.parentKey || null,
      parentKeyOpts.parentDependenciesKey || null,
      parent,
      job.repeatJobKey,
      job.deduplicationId ? `${queueKeys.de}:${job.deduplicationId}` : null,
    ];

    let encodedOpts;
    if (opts.repeat) {
      const repeat = {
        ...opts.repeat,
      };

      if (repeat.startDate) {
        repeat.startDate = +new Date(repeat.startDate);
      }
      if (repeat.endDate) {
        repeat.endDate = +new Date(repeat.endDate);
      }

      encodedOpts = pack({
        ...opts,
        repeat,
      });
    } else {
      encodedOpts = pack(opts);
    }

    let result: string | number;

    if (parentKeyOpts.addToWaitingChildren) {
      result = await this.addParentJob(client, job, encodedOpts, args);
    } else if (typeof opts.delay == 'number' && opts.delay > 0) {
      result = await this.addDelayedJob(client, job, encodedOpts, args);
    } else if (opts.priority) {
      result = await this.addPrioritizedJob(client, job, encodedOpts, args);
    } else {
      result = await this.addStandardJob(client, job, encodedOpts, args);
    }

    if (<number>result < 0) {
      throw this.finishedErrors({
        code: <number>result,
        parentKey: parentKeyOpts.parentKey,
        command: 'addJob',
      });
    }

    return <string>result;
  }

  protected pauseArgs(pause: boolean): (string | number)[] {
    let src = 'wait',
      dst = 'paused';
    if (!pause) {
      src = 'paused';
      dst = 'wait';
    }

    const keys = [src, dst, 'meta', 'prioritized'].map((name: string) =>
      this.queue.toKey(name),
    );

    keys.push(
      this.queue.keys.events,
      this.queue.keys.delayed,
      this.queue.keys.marker,
    );

    const args = [pause ? 'paused' : 'resumed'];

    return keys.concat(args);
  }

  async pause(pause: boolean): Promise<void> {
    const client = await this.queue.client;

    const args = this.pauseArgs(pause);
    return this.execCommand(client, 'pause', args);
  }

  protected addRepeatableJobArgs(
    customKey: string,
    nextMillis: number,
    opts: RepeatableOptions,
    legacyCustomKey: string,
  ): (string | number | Buffer)[] {
    const queueKeys = this.queue.keys;
    const keys: (string | number | Buffer)[] = [
      queueKeys.repeat,
      queueKeys.delayed,
    ];

    const args = [
      nextMillis,
      pack(opts),
      legacyCustomKey,
      customKey,
      queueKeys[''],
    ];

    return keys.concat(args);
  }

  async addRepeatableJob(
    customKey: string,
    nextMillis: number,
    opts: RepeatableOptions,
    legacyCustomKey: string,
  ): Promise<string> {
    const client = await this.queue.client;

    const args = this.addRepeatableJobArgs(
      customKey,
      nextMillis,
      opts,
      legacyCustomKey,
    );
    return this.execCommand(client, 'addRepeatableJob', args);
  }

  async removeDeduplicationKey(
    deduplicationId: string,
    jobId: string,
  ): Promise<number> {
    const client = await this.queue.client;
    const queueKeys = this.queue.keys;

    const keys: string[] = [`${queueKeys.de}:${deduplicationId}`];

    const args = [jobId];

    return this.execCommand(
      client,
      'removeDeduplicationKey',
      keys.concat(args),
    );
  }

  async addJobScheduler(
    jobSchedulerId: string,
    nextMillis: number,
    templateData: string,
    templateOpts: RedisJobOptions,
    opts: RepeatableOptions,
    delayedJobOpts: JobsOptions,
    // The job id of the job that produced this next iteration
    producerId?: string,
  ): Promise<[string, number]> {
    const client = await this.queue.client;
    const queueKeys = this.queue.keys;

    const keys: (string | number | Buffer)[] = [
      queueKeys.repeat,
      queueKeys.delayed,
      queueKeys.wait,
      queueKeys.paused,
      queueKeys.meta,
      queueKeys.prioritized,
      queueKeys.marker,
      queueKeys.id,
      queueKeys.events,
      queueKeys.pc,
      queueKeys.active,
    ];

    const args = [
      nextMillis,
      pack(opts),
      jobSchedulerId,
      templateData,
      pack(templateOpts),
      pack(delayedJobOpts),
      Date.now(),
      queueKeys[''],
      producerId ? this.queue.toKey(producerId) : '',
    ];

    const result = await this.execCommand(
      client,
      'addJobScheduler',
      keys.concat(args),
    );

    if (typeof result === 'number' && result < 0) {
      throw this.finishedErrors({
        code: result,
        command: 'addJobScheduler',
      });
    }

    return result;
  }

  async updateRepeatableJobMillis(
    client: RedisClient,
    customKey: string,
    nextMillis: number,
    legacyCustomKey: string,
  ): Promise<string> {
    const args = [
      this.queue.keys.repeat,
      nextMillis,
      customKey,
      legacyCustomKey,
    ];
    return this.execCommand(client, 'updateRepeatableJobMillis', args);
  }

  async updateJobSchedulerNextMillis(
    jobSchedulerId: string,
    nextMillis: number,
    templateData: string,
    delayedJobOpts: JobsOptions,
    // The job id of the job that produced this next iteration - TODO: remove in next breaking change
    producerId?: string,
  ): Promise<string | null> {
    const client = await this.queue.client;

    const queueKeys = this.queue.keys;

    const keys: (string | number | Buffer)[] = [
      queueKeys.repeat,
      queueKeys.delayed,
      queueKeys.wait,
      queueKeys.paused,
      queueKeys.meta,
      queueKeys.prioritized,
      queueKeys.marker,
      queueKeys.id,
      queueKeys.events,
      queueKeys.pc,
      producerId ? this.queue.toKey(producerId) : '',
      queueKeys.active,
    ];

    const args = [
      nextMillis,
      jobSchedulerId,
      templateData,
      pack(delayedJobOpts),
      Date.now(),
      queueKeys[''],
      producerId,
    ];

    return this.execCommand(client, 'updateJobScheduler', keys.concat(args));
  }

  private removeRepeatableArgs(
    legacyRepeatJobId: string,
    repeatConcatOptions: string,
    repeatJobKey: string,
  ): string[] {
    const queueKeys = this.queue.keys;

    const keys = [queueKeys.repeat, queueKeys.delayed, queueKeys.events];

    const args = [
      legacyRepeatJobId,
      this.getRepeatConcatOptions(repeatConcatOptions, repeatJobKey),
      repeatJobKey,
      queueKeys[''],
    ];

    return keys.concat(args);
  }

  // TODO: remove this check in next breaking change
  getRepeatConcatOptions(repeatConcatOptions: string, repeatJobKey: string) {
    if (repeatJobKey && repeatJobKey.split(':').length > 2) {
      return repeatJobKey;
    }

    return repeatConcatOptions;
  }

  async removeRepeatable(
    legacyRepeatJobId: string,
    repeatConcatOptions: string,
    repeatJobKey: string,
  ): Promise<number> {
    const client = await this.queue.client;
    const args = this.removeRepeatableArgs(
      legacyRepeatJobId,
      repeatConcatOptions,
      repeatJobKey,
    );
    return this.execCommand(client, 'removeRepeatable', args);
  }

  async removeJobScheduler(jobSchedulerId: string): Promise<number> {
    const client = await this.queue.client;

    const queueKeys = this.queue.keys;

    const keys = [queueKeys.repeat, queueKeys.delayed, queueKeys.events];

    const args = [jobSchedulerId, queueKeys['']];

    return this.execCommand(client, 'removeJobScheduler', keys.concat(args));
  }

  protected removeArgs(
    jobId: string,
    removeChildren: boolean,
  ): (string | number)[] {
    const keys: (string | number)[] = [jobId, 'repeat'].map(name =>
      this.queue.toKey(name),
    );

    const args = [jobId, removeChildren ? 1 : 0, this.queue.toKey('')];

    return keys.concat(args);
  }

  async remove(jobId: string, removeChildren: boolean): Promise<number> {
    const client = await this.queue.client;

    const args = this.removeArgs(jobId, removeChildren);
    const result = await this.execCommand(client, 'removeJob', args);

    if (result < 0) {
      throw this.finishedErrors({
        code: result,
        jobId,
        command: 'removeJob',
      });
    }

    return result;
  }

  async removeUnprocessedChildren(jobId: string): Promise<void> {
    const client = await this.queue.client;

    const args = [
      this.queue.toKey(jobId),
      this.queue.keys.meta,
      this.queue.toKey(''),
      jobId,
    ];

    await this.execCommand(client, 'removeUnprocessedChildren', args);
  }

  async extendLock(
    jobId: string,
    token: string,
    duration: number,
    client?: RedisClient | ChainableCommander,
  ): Promise<number> {
    client = client || (await this.queue.client);
    const args = [
      this.queue.toKey(jobId) + ':lock',
      this.queue.keys.stalled,
      token,
      duration,
      jobId,
    ];
    return this.execCommand(client, 'extendLock', args);
  }

  async extendLocks(
    jobIds: string[],
    tokens: string[],
    duration: number,
  ): Promise<string[]> {
    const client = await this.queue.client;

    const args = [
      this.queue.keys.stalled,
      this.queue.toKey(''),
      pack(tokens),
      pack(jobIds),
      duration,
    ];

    return this.execCommand(client, 'extendLocks', args);
  }

  async updateData<T = any, R = any, N extends string = string>(
    job: MinimalJob<T, R, N>,
    data: T,
  ): Promise<void> {
    const client = await this.queue.client;

    const keys = [this.queue.toKey(job.id)];
    const dataJson = JSON.stringify(data);

    const result = await this.execCommand(
      client,
      'updateData',
      keys.concat([dataJson]),
    );

    if (result < 0) {
      throw this.finishedErrors({
        code: result,
        jobId: job.id,
        command: 'updateData',
      });
    }
  }

  async updateProgress(jobId: string, progress: JobProgress): Promise<void> {
    const client = await this.queue.client;

    const keys = [
      this.queue.toKey(jobId),
      this.queue.keys.events,
      this.queue.keys.meta,
    ];
    const progressJson = JSON.stringify(progress);

    const result = await this.execCommand(
      client,
      'updateProgress',
      keys.concat([jobId, progressJson]),
    );

    if (result < 0) {
      throw this.finishedErrors({
        code: result,
        jobId,
        command: 'updateProgress',
      });
    }
  }

  async addLog(
    jobId: string,
    logRow: string,
    keepLogs?: number,
  ): Promise<number> {
    const client = await this.queue.client;

    const keys: (string | number)[] = [
      this.queue.toKey(jobId),
      this.queue.toKey(jobId) + ':logs',
    ];

    const result = await this.execCommand(
      client,
      'addLog',
      keys.concat([jobId, logRow, keepLogs ? keepLogs : '']),
    );

    if (result < 0) {
      throw this.finishedErrors({
        code: result,
        jobId,
        command: 'addLog',
      });
    }

    return result;
  }

  protected moveToFinishedArgs<T = any, R = any, N extends string = string>(
    job: MinimalJob<T, R, N>,
    val: any,
    propVal: FinishedPropValAttribute,
    shouldRemove: undefined | boolean | number | KeepJobs,
    target: FinishedStatus,
    token: string,
    timestamp: number,
    fetchNext = true,
    fieldsToUpdate?: Record<string, any>,
  ): (string | number | boolean | Buffer)[] {
    const queueKeys = this.queue.keys;
    const opts: WorkerOptions = <WorkerOptions>this.queue.opts;
    const workerKeepJobs =
      target === 'completed' ? opts.removeOnComplete : opts.removeOnFail;

    const metricsKey = this.queue.toKey(`metrics:${target}`);

    const keys = this.moveToFinishedKeys;
    keys[10] = queueKeys[target];
    keys[11] = this.queue.toKey(job.id ?? '');
    keys[12] = metricsKey;
    keys[13] = this.queue.keys.marker;

    const keepJobs = this.getKeepJobs(shouldRemove, workerKeepJobs);

    const args = [
      job.id,
      timestamp,
      propVal,
      typeof val === 'undefined' ? 'null' : val,
      target,
      !fetchNext || this.queue.closing ? 0 : 1,
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

  protected getKeepJobs(
    shouldRemove: undefined | boolean | number | KeepJobs,
    workerKeepJobs: undefined | KeepJobs,
  ) {
    if (typeof shouldRemove === 'undefined') {
      return workerKeepJobs || { count: shouldRemove ? 0 : -1 };
    }

    return typeof shouldRemove === 'object'
      ? shouldRemove
      : typeof shouldRemove === 'number'
        ? { count: shouldRemove }
        : { count: shouldRemove ? 0 : -1 };
  }

  async moveToFinished(
    jobId: string,
    args: (string | number | boolean | Buffer)[],
  ) {
    const client = await this.queue.client;

    const result = await this.execCommand(client, 'moveToFinished', args);
    if (result < 0) {
      throw this.finishedErrors({
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

  private drainArgs(delayed: boolean): (string | number)[] {
    const queueKeys = this.queue.keys;

    const keys: (string | number)[] = [
      queueKeys.wait,
      queueKeys.paused,
      queueKeys.delayed,
      queueKeys.prioritized,
      queueKeys.repeat,
    ];

    const args = [queueKeys[''], delayed ? '1' : '0'];

    return keys.concat(args);
  }

  async drain(delayed: boolean): Promise<void> {
    const client = await this.queue.client;
    const args = this.drainArgs(delayed);

    return this.execCommand(client, 'drain', args);
  }

  private removeChildDependencyArgs(
    jobId: string,
    parentKey: string,
  ): (string | number)[] {
    const queueKeys = this.queue.keys;

    const keys: string[] = [queueKeys['']];

    const args = [this.queue.toKey(jobId), parentKey];

    return keys.concat(args);
  }

  async removeChildDependency(
    jobId: string,
    parentKey: string,
  ): Promise<boolean> {
    const client = await this.queue.client;
    const args = this.removeChildDependencyArgs(jobId, parentKey);

    const result = await this.execCommand(
      client,
      'removeChildDependency',
      args,
    );

    switch (result) {
      case 0:
        return true;
      case 1:
        return false;
      default:
        throw this.finishedErrors({
          code: result,
          jobId,
          parentKey,
          command: 'removeChildDependency',
        });
    }
  }

  private getRangesArgs(
    types: JobType[],
    start: number,
    end: number,
    asc: boolean,
  ): (string | number)[] {
    const queueKeys = this.queue.keys;
    const transformedTypes = types.map(type => {
      return type === 'waiting' ? 'wait' : type;
    });

    const keys: (string | number)[] = [queueKeys['']];

    const args = [start, end, asc ? '1' : '0', ...transformedTypes];

    return keys.concat(args);
  }

  async getRanges(
    types: JobType[],
    start = 0,
    end = 1,
    asc = false,
  ): Promise<[string][]> {
    const client = await this.queue.client;
    const args = this.getRangesArgs(types, start, end, asc);

    return await this.execCommand(client, 'getRanges', args);
  }

  private getCountsArgs(types: JobType[]): (string | number)[] {
    const queueKeys = this.queue.keys;
    const transformedTypes = types.map(type => {
      return type === 'waiting' ? 'wait' : type;
    });

    const keys: (string | number)[] = [queueKeys['']];

    const args = [...transformedTypes];

    return keys.concat(args);
  }

  async getCounts(types: JobType[]): Promise<number[]> {
    const client = await this.queue.client;
    const args = this.getCountsArgs(types);

    return await this.execCommand(client, 'getCounts', args);
  }

  protected getCountsPerPriorityArgs(
    priorities: number[],
  ): (string | number)[] {
    const keys: (string | number)[] = [
      this.queue.keys.wait,
      this.queue.keys.paused,
      this.queue.keys.meta,
      this.queue.keys.prioritized,
    ];

    const args = priorities;

    return keys.concat(args);
  }

  async getCountsPerPriority(priorities: number[]): Promise<number[]> {
    const client = await this.queue.client;
    const args = this.getCountsPerPriorityArgs(priorities);

    return await this.execCommand(client, 'getCountsPerPriority', args);
  }

  protected getDependencyCountsArgs(
    jobId: string,
    types: string[],
  ): (string | number)[] {
    const keys: string[] = [
      `${jobId}:processed`,
      `${jobId}:dependencies`,
      `${jobId}:failed`,
      `${jobId}:unsuccessful`,
    ].map(name => {
      return this.queue.toKey(name);
    });

    const args = types;

    return keys.concat(args);
  }

  async getDependencyCounts(jobId: string, types: string[]): Promise<number[]> {
    const client = await this.queue.client;
    const args = this.getDependencyCountsArgs(jobId, types);

    return await this.execCommand(client, 'getDependencyCounts', args);
  }

  moveToCompletedArgs<T = any, R = any, N extends string = string>(
    job: MinimalJob<T, R, N>,
    returnvalue: R,
    removeOnComplete: boolean | number | KeepJobs,
    token: string,
    fetchNext = false,
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

  moveToFailedArgs<T = any, R = any, N extends string = string>(
    job: MinimalJob<T, R, N>,
    failedReason: string,
    removeOnFailed: boolean | number | KeepJobs,
    token: string,
    fetchNext = false,
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

  async isFinished(
    jobId: string,
    returnValue = false,
  ): Promise<number | [number, string]> {
    const client = await this.queue.client;

    const keys = ['completed', 'failed', jobId].map((key: string) => {
      return this.queue.toKey(key);
    });

    return this.execCommand(
      client,
      'isFinished',
      keys.concat([jobId, returnValue ? '1' : '']),
    );
  }

  async getState(jobId: string): Promise<JobState | 'unknown'> {
    const client = await this.queue.client;

    const keys = [
      'completed',
      'failed',
      'delayed',
      'active',
      'wait',
      'paused',
      'waiting-children',
      'prioritized',
    ].map((key: string) => {
      return this.queue.toKey(key);
    });

    if (
      isRedisVersionLowerThan(
        this.queue.redisVersion,
        '6.0.6',
        this.queue.databaseType,
      )
    ) {
      return this.execCommand(client, 'getState', keys.concat([jobId]));
    }
    return this.execCommand(client, 'getStateV2', keys.concat([jobId]));
  }

  /**
   * Change delay of a delayed job.
   *
   * Reschedules a delayed job by setting a new delay from the current time.
   * For example, calling changeDelay(5000) will reschedule the job to execute
   * 5000 milliseconds (5 seconds) from now, regardless of the original delay.
   *
   * @param jobId - the ID of the job to change the delay for.
   * @param delay - milliseconds from now when the job should be processed.
   * @returns delay in milliseconds.
   * @throws JobNotExist
   * This exception is thrown if jobId is missing.
   * @throws JobNotInState
   * This exception is thrown if job is not in delayed state.
   */
  async changeDelay(jobId: string, delay: number): Promise<void> {
    const client = await this.queue.client;

    const args = this.changeDelayArgs(jobId, delay);
    const result = await this.execCommand(client, 'changeDelay', args);
    if (result < 0) {
      throw this.finishedErrors({
        code: result,
        jobId,
        command: 'changeDelay',
        state: 'delayed',
      });
    }
  }

  private changeDelayArgs(jobId: string, delay: number): (string | number)[] {
    const timestamp = Date.now();

    const keys: (string | number)[] = [
      this.queue.keys.delayed,
      this.queue.keys.meta,
      this.queue.keys.marker,
      this.queue.keys.events,
    ];

    return keys.concat([
      delay,
      JSON.stringify(timestamp),
      jobId,
      this.queue.toKey(jobId),
    ]);
  }

  async changePriority(
    jobId: string,
    priority = 0,
    lifo = false,
  ): Promise<void> {
    const client = await this.queue.client;

    const args = this.changePriorityArgs(jobId, priority, lifo);

    const result = await this.execCommand(client, 'changePriority', args);
    if (result < 0) {
      throw this.finishedErrors({
        code: result,
        jobId,
        command: 'changePriority',
      });
    }
  }

  protected changePriorityArgs(
    jobId: string,
    priority = 0,
    lifo = false,
  ): (string | number)[] {
    const keys: (string | number)[] = [
      this.queue.keys.wait,
      this.queue.keys.paused,
      this.queue.keys.meta,
      this.queue.keys.prioritized,
      this.queue.keys.active,
      this.queue.keys.pc,
      this.queue.keys.marker,
    ];

    return keys.concat([priority, this.queue.toKey(''), jobId, lifo ? 1 : 0]);
  }

  moveToDelayedArgs(
    jobId: string,
    timestamp: number,
    token: string,
    delay: number,
    opts: MoveToDelayedOpts = {},
  ): (string | number | Buffer)[] {
    const queueKeys = this.queue.keys;

    const keys: (string | number | Buffer)[] = [
      queueKeys.marker,
      queueKeys.active,
      queueKeys.prioritized,
      queueKeys.delayed,
      this.queue.toKey(jobId),
      queueKeys.events,
      queueKeys.meta,
      queueKeys.stalled,
    ];

    return keys.concat([
      this.queue.keys[''],
      timestamp,
      jobId,
      token,
      delay,
      opts.skipAttempt ? '1' : '0',
      opts.fieldsToUpdate
        ? pack(objectToFlatArray(opts.fieldsToUpdate))
        : void 0,
    ]);
  }

  moveToWaitingChildrenArgs(
    jobId: string,
    token: string,
    opts?: MoveToWaitingChildrenOpts,
  ): (string | number)[] {
    const timestamp = Date.now();

    const childKey = getParentKey(opts.child);

    const keys: (string | number)[] = [
      'active',
      'waiting-children',
      jobId,
      `${jobId}:dependencies`,
      `${jobId}:unsuccessful`,
      'stalled',
      'events',
    ].map(name => {
      return this.queue.toKey(name);
    });

    return keys.concat([
      token,
      childKey ?? '',
      JSON.stringify(timestamp),
      jobId,
      this.queue.toKey(''),
    ]);
  }

  isMaxedArgs(): string[] {
    const queueKeys = this.queue.keys;
    const keys: string[] = [queueKeys.meta, queueKeys.active];

    return keys;
  }

  async isMaxed(): Promise<boolean> {
    const client = await this.queue.client;

    const args = this.isMaxedArgs();
    return !!(await this.execCommand(client, 'isMaxed', args));
  }

  async moveToDelayed(
    jobId: string,
    timestamp: number,
    delay: number,
    token = '0',
    opts: MoveToDelayedOpts = {},
  ): Promise<void> {
    const client = await this.queue.client;

    const args = this.moveToDelayedArgs(jobId, timestamp, token, delay, opts);

    const result = await this.execCommand(client, 'moveToDelayed', args);
    if (result < 0) {
      throw this.finishedErrors({
        code: result,
        jobId,
        command: 'moveToDelayed',
        state: 'active',
      });
    }
  }

  /**
   * Move parent job to waiting-children state.
   *
   * @returns true if job is successfully moved, false if there are pending dependencies.
   * @throws JobNotExist
   * This exception is thrown if jobId is missing.
   * @throws JobLockNotExist
   * This exception is thrown if job lock is missing.
   * @throws JobNotInState
   * This exception is thrown if job is not in active state.
   */
  async moveToWaitingChildren(
    jobId: string,
    token: string,
    opts: MoveToWaitingChildrenOpts = {},
  ): Promise<boolean> {
    const client = await this.queue.client;

    const args = this.moveToWaitingChildrenArgs(jobId, token, opts);
    const result = await this.execCommand(
      client,
      'moveToWaitingChildren',
      args,
    );

    switch (result) {
      case 0:
        return true;
      case 1:
        return false;
      default:
        throw this.finishedErrors({
          code: result,
          jobId,
          command: 'moveToWaitingChildren',
          state: 'active',
        });
    }
  }

  getRateLimitTtlArgs(maxJobs?: number): (string | number)[] {
    const keys: (string | number)[] = [
      this.queue.keys.limiter,
      this.queue.keys.meta,
    ];

    return keys.concat([maxJobs ?? '0']);
  }

  async getRateLimitTtl(maxJobs?: number): Promise<number> {
    const client = await this.queue.client;

    const args = this.getRateLimitTtlArgs(maxJobs);
    return this.execCommand(client, 'getRateLimitTtl', args);
  }

  /**
   * Remove jobs in a specific state.
   *
   * @returns Id jobs from the deleted records.
   */
  async cleanJobsInSet(
    set: string,
    timestamp: number,
    limit = 0,
  ): Promise<string[]> {
    const client = await this.queue.client;

    return this.execCommand(client, 'cleanJobsInSet', [
      this.queue.toKey(set),
      this.queue.toKey('events'),
      this.queue.toKey('repeat'),
      this.queue.toKey(''),
      timestamp,
      limit,
      set,
    ]);
  }

  getJobSchedulerArgs(id: string): string[] {
    const keys: string[] = [this.queue.keys.repeat];

    return keys.concat([id]);
  }

  async getJobScheduler(id: string): Promise<[any, string | null]> {
    const client = await this.queue.client;

    const args = this.getJobSchedulerArgs(id);

    return this.execCommand(client, 'getJobScheduler', args);
  }

  retryJobArgs(
    jobId: string,
    lifo: boolean,
    token: string,
    opts: MoveToDelayedOpts = {},
  ): (string | number | Buffer)[] {
    const keys: (string | number | Buffer)[] = [
      this.queue.keys.active,
      this.queue.keys.wait,
      this.queue.keys.paused,
      this.queue.toKey(jobId),
      this.queue.keys.meta,
      this.queue.keys.events,
      this.queue.keys.delayed,
      this.queue.keys.prioritized,
      this.queue.keys.pc,
      this.queue.keys.marker,
      this.queue.keys.stalled,
    ];

    const pushCmd = (lifo ? 'R' : 'L') + 'PUSH';

    return keys.concat([
      this.queue.toKey(''),
      Date.now(),
      pushCmd,
      jobId,
      token,
      opts.fieldsToUpdate
        ? pack(objectToFlatArray(opts.fieldsToUpdate))
        : void 0,
    ]);
  }

  async retryJob(
    jobId: string,
    lifo: boolean,
    token = '0',
    opts: RetryJobOpts = {},
  ): Promise<void> {
    const client = await this.queue.client;

    const args = this.retryJobArgs(jobId, lifo, token, opts);
    const result = await this.execCommand(client, 'retryJob', args);
    if (result < 0) {
      throw this.finishedErrors({
        code: result,
        jobId,
        command: 'retryJob',
        state: 'active',
      });
    }
  }

  protected moveJobsToWaitArgs(
    state: FinishedStatus | 'delayed',
    count: number,
    timestamp: number,
  ): (string | number)[] {
    const keys: (string | number)[] = [
      this.queue.toKey(''),
      this.queue.keys.events,
      this.queue.toKey(state),
      this.queue.toKey('wait'),
      this.queue.toKey('paused'),
      this.queue.keys.meta,
      this.queue.keys.active,
      this.queue.keys.marker,
    ];

    const args = [count, timestamp, state];

    return keys.concat(args);
  }

  async retryJobs(
    state: FinishedStatus = 'failed',
    count = 1000,
    timestamp = new Date().getTime(),
  ): Promise<number> {
    const client = await this.queue.client;

    const args = this.moveJobsToWaitArgs(state, count, timestamp);

    return this.execCommand(client, 'moveJobsToWait', args);
  }

  async promoteJobs(count = 1000): Promise<number> {
    const client = await this.queue.client;

    const args = this.moveJobsToWaitArgs('delayed', count, Number.MAX_VALUE);

    return this.execCommand(client, 'moveJobsToWait', args);
  }

  /**
   * Attempts to reprocess a job
   *
   * @param job - The job to reprocess
   * @param state - The expected job state. If the job is not found
   * on the provided state, then it's not reprocessed. Supported states: 'failed', 'completed'
   *
   * @returns A promise that resolves when the job has been successfully moved to the wait queue.
   * @throws Will throw an error with a code property indicating the failure reason:
   *   - code 0: Job does not exist
   *   - code -1: Job is currently locked and can't be retried
   *   - code -2: Job was not found in the expected set
   */
  async reprocessJob<T = any, R = any, N extends string = string>(
    job: MinimalJob<T, R, N>,
    state: 'failed' | 'completed',
    opts: RetryOptions = {},
  ): Promise<void> {
    const client = await this.queue.client;

    const keys = [
      this.queue.toKey(job.id),
      this.queue.keys.events,
      this.queue.toKey(state),
      this.queue.keys.wait,
      this.queue.keys.meta,
      this.queue.keys.paused,
      this.queue.keys.active,
      this.queue.keys.marker,
    ];

    const args = [
      job.id,
      (job.opts.lifo ? 'R' : 'L') + 'PUSH',
      state === 'failed' ? 'failedReason' : 'returnvalue',
      state,
      opts.resetAttemptsMade ? '1' : '0',
      opts.resetAttemptsStarted ? '1' : '0',
    ];

    const result = await this.execCommand(
      client,
      'reprocessJob',
      keys.concat(args),
    );

    switch (result) {
      case 1:
        return;
      default:
        throw this.finishedErrors({
          code: result,
          jobId: job.id,
          command: 'reprocessJob',
          state,
        });
    }
  }

  async getMetrics(
    type: 'completed' | 'failed',
    start = 0,
    end = -1,
  ): Promise<[string[], string[], number]> {
    const client = await this.queue.client;

    const keys: (string | number)[] = [
      this.queue.toKey(`metrics:${type}`),
      this.queue.toKey(`metrics:${type}:data`),
    ];
    const args = [start, end];

    const result = await this.execCommand(
      client,
      'getMetrics',
      keys.concat(args),
    );

    return result;
  }

  async moveToActive(client: RedisClient, token: string, name?: string) {
    const opts = this.queue.opts as WorkerOptions;

    const queueKeys = this.queue.keys;
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

    const result = await this.execCommand(
      client,
      'moveToActive',
      (<(string | number | boolean | Buffer)[]>keys).concat(args),
    );

    return raw2NextJobData(result);
  }

  async promote(jobId: string): Promise<void> {
    const client = await this.queue.client;

    const keys = [
      this.queue.keys.delayed,
      this.queue.keys.wait,
      this.queue.keys.paused,
      this.queue.keys.meta,
      this.queue.keys.prioritized,
      this.queue.keys.active,
      this.queue.keys.pc,
      this.queue.keys.events,
      this.queue.keys.marker,
    ];

    const args = [this.queue.toKey(''), jobId];

    const code = await this.execCommand(client, 'promote', keys.concat(args));
    if (code < 0) {
      throw this.finishedErrors({
        code,
        jobId,
        command: 'promote',
        state: 'delayed',
      });
    }
  }

  protected moveStalledJobsToWaitArgs(): (string | number)[] {
    const opts = this.queue.opts as WorkerOptions;
    const keys: (string | number)[] = [
      this.queue.keys.stalled,
      this.queue.keys.wait,
      this.queue.keys.active,
      this.queue.keys['stalled-check'],
      this.queue.keys.meta,
      this.queue.keys.paused,
      this.queue.keys.marker,
      this.queue.keys.events,
    ];
    const args = [
      opts.maxStalledCount,
      this.queue.toKey(''),
      Date.now(),
      opts.stalledInterval,
    ];

    return keys.concat(args);
  }

  /**
   * Looks for unlocked jobs in the active queue.
   *
   * The job was being worked on, but the worker process died and it failed to renew the lock.
   * We call these jobs 'stalled'. This is the most common case. We resolve these by moving them
   * back to wait to be re-processed. To prevent jobs from cycling endlessly between active and wait,
   * (e.g. if the job handler keeps crashing),
   * we limit the number stalled job recoveries to settings.maxStalledCount.
   */
  async moveStalledJobsToWait(): Promise<string[]> {
    const client = await this.queue.client;

    const args = this.moveStalledJobsToWaitArgs();

    return this.execCommand(client, 'moveStalledJobsToWait', args);
  }

  /**
   * Moves a job back from Active to Wait.
   * This script is used when a job has been manually rate limited and needs
   * to be moved back to wait from active status.
   *
   * @param client - Redis client
   * @param jobId - Job id
   * @returns
   */
  async moveJobFromActiveToWait(jobId: string, token = '0') {
    const client = await this.queue.client;

    const keys: (string | number)[] = [
      this.queue.keys.active,
      this.queue.keys.wait,
      this.queue.keys.stalled,
      this.queue.keys.paused,
      this.queue.keys.meta,
      this.queue.keys.limiter,
      this.queue.keys.prioritized,
      this.queue.keys.marker,
      this.queue.keys.events,
    ];

    const args = [jobId, token, this.queue.toKey(jobId)];

    const result = await this.execCommand(
      client,
      'moveJobFromActiveToWait',
      keys.concat(args),
    );

    if (result < 0) {
      throw this.finishedErrors({
        code: result,
        jobId,
        command: 'moveJobFromActiveToWait',
        state: 'active',
      });
    }

    return result;
  }

  async obliterate(opts: { force: boolean; count: number }): Promise<number> {
    const client = await this.queue.client;

    const keys: (string | number)[] = [
      this.queue.keys.meta,
      this.queue.toKey(''),
    ];
    const args = [opts.count, opts.force ? 'force' : null];

    const result = await this.execCommand(
      client,
      'obliterate',
      keys.concat(args),
    );
    if (result < 0) {
      switch (result) {
        case -1:
          throw new Error('Cannot obliterate non-paused queue');
        case -2:
          throw new Error('Cannot obliterate queue with active jobs');
      }
    }
    return result;
  }

  /**
   * Paginate a set or hash keys.
   * @param opts - options to define the pagination behaviour
   *
   */
  async paginate(
    key: string,
    opts: { start: number; end: number; fetchJobs?: boolean },
  ): Promise<{
    cursor: string;
    items: { id: string; v?: any; err?: string }[];
    total: number;
    jobs?: JobJsonRaw[];
  }> {
    const client = await this.queue.client;

    const keys: (string | number)[] = [key];

    const maxIterations = 5;

    const pageSize = opts.end >= 0 ? opts.end - opts.start + 1 : Infinity;

    let cursor = '0',
      offset = 0,
      items,
      total,
      rawJobs,
      page: string[] = [],
      jobs: JobJsonRaw[] = [];
    do {
      const args = [
        opts.start + page.length,
        opts.end,
        cursor,
        offset,
        maxIterations,
      ];

      if (opts.fetchJobs) {
        args.push(1);
      }

      [cursor, offset, items, total, rawJobs] = await this.execCommand(
        client,
        'paginate',
        keys.concat(args),
      );

      page = page.concat(items);

      if (rawJobs && rawJobs.length) {
        jobs = jobs.concat(rawJobs.map(array2obj));
      }

      // Important to keep this coercive inequality (!=) instead of strict inequality (!==)
    } while (cursor != '0' && page.length < pageSize);

    // If we get an array of arrays, it means we are paginating a hash
    if (page.length && Array.isArray(page[0])) {
      const result = [];
      for (let index = 0; index < page.length; index++) {
        const [id, value] = page[index];
        try {
          result.push({ id, v: JSON.parse(value) });
        } catch (err) {
          result.push({ id, err: (<Error>err).message });
        }
      }

      return {
        cursor,
        items: result,
        total,
        jobs,
      };
    } else {
      return {
        cursor,
        items: page.map(item => ({ id: item })),
        total,
        jobs,
      };
    }
  }

  finishedErrors({
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
        error = new Error(
          `Missing key for parent job ${parentKey}. ${command}`,
        );
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
        error = new Error(
          `Unknown code ${code} error for ${jobId}. ${command}`,
        );
    }

    // Add the code property to the error object
    (error as any).code = code;
    return error;
  }

  // ---------------------------------------------------------------------------
  // Group scripts
  // ---------------------------------------------------------------------------

  /**
   * Atomically creates a group metadata hash, adds job keys to the membership
   * hash, and registers the group in the index sorted set.
   * Called on a `client.multi()` pipeline in FlowProducer.addGroup().
   */
  createGroup(
    client: ChainableCommander,
    queueName: string,
    groupId: string,
    groupName: string,
    timestamp: number,
    totalJobs: number,
    compensationJson: string,
    jobKeys: string[],
  ): void {
    const prefix = this.queue.opts.prefix || 'bull';
    const gk = new QueueKeys(prefix);
    const keys = [
      gk.toGroupKey(queueName, groupId),
      gk.toGroupJobsKey(queueName, groupId),
      gk.toGroupsIndexKey(queueName),
      this.queue.keys.events,
    ];
    const argv = [
      groupId,
      groupName,
      String(timestamp),
      String(totalJobs),
      compensationJson,
      ...jobKeys,
    ];
    this.execCommand(client, 'createGroup', [...keys, ...argv]);
  }

  /**
   * Called after moveToFinished for a group member job. Updates the group's
   * job status, counters, and state. Returns a compensation trigger object
   * if the group transitions to COMPENSATING.
   */
  async updateGroupOnFinished(
    groupId: string,
    ownerQueueName: string,
    jobKey: string,
    finalStatus: 'completed' | 'failed',
    returnValue: any,
    timestamp: number,
  ): Promise<{ trigger?: 'compensation'; completedJobsForCompensation?: string[] } | null> {
    const client = await this.queue.client;
    const prefix = this.queue.opts.prefix || 'bull';
    const gk = new QueueKeys(prefix);

    // For the events key, use the owner queue's events stream
    const ownerEventsKey = gk.toKey(ownerQueueName, 'events');

    const keys = [
      gk.toGroupKey(ownerQueueName, groupId),
      gk.toGroupJobsKey(ownerQueueName, groupId),
      ownerEventsKey,
    ];
    const returnValueStr =
      returnValue !== undefined && returnValue !== null
        ? JSON.stringify(returnValue)
        : '';
    const argv = [jobKey, finalStatus, String(timestamp), returnValueStr];

    const result: any = await this.execCommand(client, 'updateGroupOnFinished', [
      ...keys,
      ...argv,
    ]);

    if (!result) {
      return null;
    }

    // result is an array: ["compensation", jobKey1, jobKey2, ...]
    if (Array.isArray(result) && result[0] === 'compensation') {
      const completedJobsForCompensation = result.slice(1) as string[];
      return { trigger: 'compensation', completedJobsForCompensation };
    }

    return null;
  }

  /**
   * Cancels all pending/waiting/delayed jobs in a group and updates group state
   * to COMPENSATING or FAILED.
   */
  async cancelGroupJobs(
    groupId: string,
    ownerQueueName: string,
    timestamp: number,
  ): Promise<string[]> {
    const client = await this.queue.client;
    const prefix = this.queue.opts.prefix || 'bull';
    const gk = new QueueKeys(prefix);

    const ownerEventsKey = gk.toKey(ownerQueueName, 'events');

    const keys = [
      gk.toGroupKey(ownerQueueName, groupId),
      gk.toGroupJobsKey(ownerQueueName, groupId),
      ownerEventsKey,
    ];
    const argv = [String(timestamp), groupId];

    const result: any = await this.execCommand(client, 'cancelGroupJobs', [
      ...keys,
      ...argv,
    ]);

    return Array.isArray(result) ? (result as string[]) : [];
  }

  /**
   * Enqueues compensation jobs for a list of completed group member jobs.
   * Groups completed jobs by their source queue and calls triggerCompensation
   * once per unique compensation queue.
   */
  async triggerCompensation(
    groupId: string,
    ownerQueueName: string,
    completedJobKeys: string[],
    compensationMap: Record<string, any>,
    compensationJobReturnValues: Record<string, string> = {},
  ): Promise<void> {
    if (completedJobKeys.length === 0) {
      return;
    }

    const client = await this.queue.client;
    const prefix = this.queue.opts.prefix || 'bull';
    const gk = new QueueKeys(prefix);

    // Group compensation jobs by their compensation queue (source queue + :compensation)
    // completedJobKey format: {prefix}:{jobQueueName}:{jobId}
    const byCompQueue: Map<string, any[]> = new Map();

    for (const jobKey of completedJobKeys) {
      // Parse jobKey: {prefix}:{queueName}:{jobId}
      const parts = jobKey.split(':');
      if (parts.length < 3) {
        continue;
      }
      // jobId is the last segment, queueName is the middle part(s)
      const jobId = parts[parts.length - 1];
      const jobQueueName = parts.slice(1, parts.length - 1).join(':');
      const compQueueName = `${jobQueueName}:compensation`;

      // Match compensation definition by jobId or jobName
      // We need the job name to look up the compensation map.
      // For simplicity, store jobId-indexed return values and find by scanning
      // The compensation map is keyed by job NAME (from GroupJobDefinition.name)
      // We don't have the name here, so we'll pass ALL compensations and let
      // the TypeScript caller filter by name. For now, we pass all compensation entries
      // associated with this queue.

      if (!byCompQueue.has(compQueueName)) {
        byCompQueue.set(compQueueName, []);
      }

      const returnValueJson = compensationJobReturnValues[jobId] || '{}';

      // Find all compensation entries for this job (by checking all keys)
      // The compensationMap keys are job names. We match via the jobId stored
      // in compensationJobReturnValues which maps jobId -> returnValue.
      for (const [jobName, compDef] of Object.entries(compensationMap)) {
        const compJobData = {
          groupId,
          originalJobName: jobName,
          originalJobId: jobId,
          originalReturnValue: JSON.parse(returnValueJson),
          compensationData: compDef.data,
        };
        const defaultOpts = {
          attempts: 3,
          backoff: { type: 'exponential', delay: 1000 },
          ...compDef.opts,
        };
        byCompQueue.get(compQueueName)!.push([
          compDef.name,
          JSON.stringify(compJobData),
          JSON.stringify(defaultOpts),
          String(Date.now()),
        ]);
        break; // only first match per jobKey
      }
    }

    const ownerGroupHashKey = gk.toGroupKey(ownerQueueName, groupId);
    let totalCompJobs = 0;

    for (const [compQueueName, jobDescs] of byCompQueue.entries()) {
      if (jobDescs.length === 0) {
        continue;
      }

      const waitKey = gk.toKey(compQueueName, 'wait');
      const metaKey = gk.toKey(compQueueName, 'meta');
      const eventsKey = gk.toKey(compQueueName, 'events');

      const keys = [waitKey, metaKey, eventsKey];
      const argv = [prefix, pack(jobDescs)];

      await this.execCommand(client, 'triggerCompensation', [...keys, ...argv]);
      totalCompJobs += jobDescs.length;
    }

    // Store totalCompensationJobs in the group hash so updateGroupCompensation knows when done
    if (totalCompJobs > 0) {
      await client.hset(ownerGroupHashKey, 'totalCompensationJobs', totalCompJobs);
    }
  }

  /**
   * Reads group metadata from Redis. Returns null for non-existent groups.
   */
  async getGroupState(
    groupId: string,
    ownerQueueName: string,
  ): Promise<Record<string, string> | null> {
    const client = await this.queue.client;
    const prefix = this.queue.opts.prefix || 'bull';
    const gk = new QueueKeys(prefix);

    const keys = [gk.toGroupKey(ownerQueueName, groupId)];

    const result: any = await this.execCommand(client, 'getGroupState', keys);

    if (!result || (Array.isArray(result) && result.length === 0)) {
      return null;
    }

    // HGETALL returns a flat array [field1, value1, field2, value2, ...]
    return array2obj(result);
  }

  /**
   * Tracks completion of a single compensation job and transitions the group
   * to FAILED or FAILED_COMPENSATION once all compensations are done.
   */
  async updateGroupCompensation(
    groupId: string,
    ownerQueueName: string,
    compensationJobKey: string,
    outcome: 'success' | 'failure',
    timestamp: number,
  ): Promise<string | null> {
    const client = await this.queue.client;
    const prefix = this.queue.opts.prefix || 'bull';
    const gk = new QueueKeys(prefix);

    const ownerEventsKey = gk.toKey(ownerQueueName, 'events');

    const keys = [gk.toGroupKey(ownerQueueName, groupId), ownerEventsKey];
    const argv = [compensationJobKey, outcome, String(timestamp), groupId];

    const result: any = await this.execCommand(client, 'updateGroupCompensation', [
      ...keys,
      ...argv,
    ]);

    return result ? String(result) : null;
  }
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
