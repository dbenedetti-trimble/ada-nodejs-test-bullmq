'use strict';
import { ChainableCommander } from 'ioredis';
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
} from '../../interfaces';
import {
  JobsOptions,
  JobState,
  JobType,
  FinishedStatus,
  FinishedPropValAttribute,
  KeepJobs,
  RedisJobOptions,
  JobProgress,
} from '../../types';
import { version as packageVersion } from '../../version';
import {
  ScriptContext,
  finishedErrors,
  isJobInList,
} from './script-utils';
import { JobScripts } from './job-scripts';
import { QueueScripts } from './queue-scripts';
import { FlowScripts } from './flow-scripts';
import { SchedulerScripts } from './scheduler-scripts';
import { WorkerScripts } from './worker-scripts';

export type JobData = [JobJsonRaw | number, string?];

export class Scripts {
  protected version = packageVersion;

  private readonly ctx: ScriptContext;
  private jobScripts: JobScripts;
  private queueScripts: QueueScripts;
  private flowScripts: FlowScripts;
  private schedulerScripts: SchedulerScripts;
  private workerScripts: WorkerScripts;

  constructor(protected queue: ScriptQueueContext) {
    const self = this;
    this.ctx = {
      get keys() { return queue.keys; },
      get opts() { return queue.opts; },
      get toKey() { return queue.toKey; },
      get closing() { return queue.closing; },
      get client() { return queue.client; },
      get redisVersion() { return queue.redisVersion; },
      get databaseType() { return queue.databaseType; },
      execCommand: self.execCommand.bind(self),
    };

    this.jobScripts = new JobScripts(this.ctx);
    this.queueScripts = new QueueScripts(this.ctx);
    this.flowScripts = new FlowScripts(this.ctx);
    this.schedulerScripts = new SchedulerScripts(this.ctx);
    this.workerScripts = new WorkerScripts(this.ctx);
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
    return isJobInList(this.ctx, listKey, jobId);
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
    return finishedErrors({ code, jobId, parentKey, command, state });
  }

  // Job domain methods

  protected addDelayedJobArgs(
    job: JobJson,
    encodedOpts: any,
    args: (string | number | Record<string, any>)[],
  ): (string | Buffer)[] {
    return this.jobScripts.addDelayedJobArgs(job, encodedOpts, args);
  }

  protected addDelayedJob(
    client: RedisClient,
    job: JobJson,
    encodedOpts: any,
    args: (string | number | Record<string, any>)[],
  ): Promise<string | number> {
    return this.jobScripts.addDelayedJob(client, job, encodedOpts, args);
  }

  protected addPrioritizedJobArgs(
    job: JobJson,
    encodedOpts: any,
    args: (string | number | Record<string, any>)[],
  ): (string | Buffer)[] {
    return this.jobScripts.addPrioritizedJobArgs(job, encodedOpts, args);
  }

  protected addPrioritizedJob(
    client: RedisClient,
    job: JobJson,
    encodedOpts: any,
    args: (string | number | Record<string, any>)[],
  ): Promise<string | number> {
    return this.jobScripts.addPrioritizedJob(client, job, encodedOpts, args);
  }

  protected addParentJobArgs(
    job: JobJson,
    encodedOpts: any,
    args: (string | number | Record<string, any>)[],
  ): (string | Buffer)[] {
    return this.jobScripts.addParentJobArgs(job, encodedOpts, args);
  }

  protected addParentJob(
    client: RedisClient,
    job: JobJson,
    encodedOpts: any,
    args: (string | number | Record<string, any>)[],
  ): Promise<string | number> {
    return this.jobScripts.addParentJob(client, job, encodedOpts, args);
  }

  protected addStandardJobArgs(
    job: JobJson,
    encodedOpts: any,
    args: (string | number | Record<string, any>)[],
  ): (string | Buffer)[] {
    return this.jobScripts.addStandardJobArgs(job, encodedOpts, args);
  }

  protected addStandardJob(
    client: RedisClient,
    job: JobJson,
    encodedOpts: any,
    args: (string | number | Record<string, any>)[],
  ): Promise<string | number> {
    return this.jobScripts.addStandardJob(client, job, encodedOpts, args);
  }

  async addJob(
    client: RedisClient,
    job: JobJson,
    opts: RedisJobOptions,
    jobId: string,
    parentKeyOpts: ParentKeyOpts = {},
  ): Promise<string> {
    return this.jobScripts.addJob(client, job, opts, jobId, parentKeyOpts);
  }

  protected removeArgs(
    jobId: string,
    removeChildren: boolean,
  ): (string | number)[] {
    return this.jobScripts.removeArgs(jobId, removeChildren);
  }

  async remove(jobId: string, removeChildren: boolean): Promise<number> {
    return this.jobScripts.remove(jobId, removeChildren);
  }

  async removeUnprocessedChildren(jobId: string): Promise<void> {
    return this.jobScripts.removeUnprocessedChildren(jobId);
  }

  async updateData<T = any, R = any, N extends string = string>(
    job: MinimalJob<T, R, N>,
    data: T,
  ): Promise<void> {
    return this.jobScripts.updateData(job, data);
  }

  async updateProgress(jobId: string, progress: JobProgress): Promise<void> {
    return this.jobScripts.updateProgress(jobId, progress);
  }

  async addLog(
    jobId: string,
    logRow: string,
    keepLogs?: number,
  ): Promise<number> {
    return this.jobScripts.addLog(jobId, logRow, keepLogs);
  }

  async isFinished(
    jobId: string,
    returnValue = false,
  ): Promise<number | [number, string]> {
    return this.jobScripts.isFinished(jobId, returnValue);
  }

  async getState(jobId: string): Promise<JobState | 'unknown'> {
    return this.jobScripts.getState(jobId);
  }

  async changeDelay(jobId: string, delay: number): Promise<void> {
    return this.jobScripts.changeDelay(jobId, delay);
  }

  async changePriority(
    jobId: string,
    priority = 0,
    lifo = false,
  ): Promise<void> {
    return this.jobScripts.changePriority(jobId, priority, lifo);
  }

  protected changePriorityArgs(
    jobId: string,
    priority = 0,
    lifo = false,
  ): (string | number)[] {
    return this.jobScripts.changePriorityArgs(jobId, priority, lifo);
  }

  retryJobArgs(
    jobId: string,
    lifo: boolean,
    token: string,
    opts: MoveToDelayedOpts = {},
  ): (string | number | Buffer)[] {
    return this.jobScripts.retryJobArgs(jobId, lifo, token, opts);
  }

  async retryJob(
    jobId: string,
    lifo: boolean,
    token = '0',
    opts: RetryJobOpts = {},
  ): Promise<void> {
    return this.jobScripts.retryJob(jobId, lifo, token, opts);
  }

  async reprocessJob<T = any, R = any, N extends string = string>(
    job: MinimalJob<T, R, N>,
    state: 'failed' | 'completed',
    opts: RetryOptions = {},
  ): Promise<void> {
    return this.jobScripts.reprocessJob(job, state, opts);
  }

  async promote(jobId: string): Promise<void> {
    return this.jobScripts.promote(jobId);
  }

  async removeDeduplicationKey(
    deduplicationId: string,
    jobId: string,
  ): Promise<number> {
    return this.jobScripts.removeDeduplicationKey(deduplicationId, jobId);
  }

  // Queue domain methods

  protected pauseArgs(pause: boolean): (string | number)[] {
    return this.queueScripts.pauseArgs(pause);
  }

  async pause(pause: boolean): Promise<void> {
    return this.queueScripts.pause(pause);
  }

  async drain(delayed: boolean): Promise<void> {
    return this.queueScripts.drain(delayed);
  }

  async obliterate(opts: { force: boolean; count: number }): Promise<number> {
    return this.queueScripts.obliterate(opts);
  }

  async getRanges(
    types: JobType[],
    start = 0,
    end = 1,
    asc = false,
  ): Promise<[string][]> {
    return this.queueScripts.getRanges(types, start, end, asc);
  }

  async getCounts(types: JobType[]): Promise<number[]> {
    return this.queueScripts.getCounts(types);
  }

  protected getCountsPerPriorityArgs(
    priorities: number[],
  ): (string | number)[] {
    return this.queueScripts.getCountsPerPriorityArgs(priorities);
  }

  async getCountsPerPriority(priorities: number[]): Promise<number[]> {
    return this.queueScripts.getCountsPerPriority(priorities);
  }

  getRateLimitTtlArgs(maxJobs?: number): (string | number)[] {
    return this.queueScripts.getRateLimitTtlArgs(maxJobs);
  }

  async getRateLimitTtl(maxJobs?: number): Promise<number> {
    return this.queueScripts.getRateLimitTtl(maxJobs);
  }

  isMaxedArgs(): string[] {
    return this.queueScripts.isMaxedArgs();
  }

  async isMaxed(): Promise<boolean> {
    return this.queueScripts.isMaxed();
  }

  async cleanJobsInSet(
    set: string,
    timestamp: number,
    limit = 0,
  ): Promise<string[]> {
    return this.queueScripts.cleanJobsInSet(set, timestamp, limit);
  }

  async paginate(
    key: string,
    opts: { start: number; end: number; fetchJobs?: boolean },
  ): Promise<{
    cursor: string;
    items: { id: string; v?: any; err?: string }[];
    total: number;
    jobs?: JobJsonRaw[];
  }> {
    return this.queueScripts.paginate(key, opts);
  }

  async moveJobFromActiveToWait(jobId: string, token = '0') {
    return this.queueScripts.moveJobFromActiveToWait(jobId, token);
  }

  async getMetrics(
    type: 'completed' | 'failed',
    start = 0,
    end = -1,
  ): Promise<[string[], string[], number]> {
    return this.queueScripts.getMetrics(type, start, end);
  }

  // Flow domain methods

  async removeChildDependency(
    jobId: string,
    parentKey: string,
  ): Promise<boolean> {
    return this.flowScripts.removeChildDependency(jobId, parentKey);
  }

  moveToWaitingChildrenArgs(
    jobId: string,
    token: string,
    opts?: MoveToWaitingChildrenOpts,
  ): (string | number)[] {
    return this.flowScripts.moveToWaitingChildrenArgs(jobId, token, opts);
  }

  async moveToWaitingChildren(
    jobId: string,
    token: string,
    opts: MoveToWaitingChildrenOpts = {},
  ): Promise<boolean> {
    return this.flowScripts.moveToWaitingChildren(jobId, token, opts);
  }

  protected getDependencyCountsArgs(
    jobId: string,
    types: string[],
  ): (string | number)[] {
    return this.flowScripts.getDependencyCountsArgs(jobId, types);
  }

  async getDependencyCounts(jobId: string, types: string[]): Promise<number[]> {
    return this.flowScripts.getDependencyCounts(jobId, types);
  }

  // Scheduler domain methods

  protected addRepeatableJobArgs(
    customKey: string,
    nextMillis: number,
    opts: RepeatableOptions,
    legacyCustomKey: string,
  ): (string | number | Buffer)[] {
    return this.schedulerScripts.addRepeatableJobArgs(
      customKey,
      nextMillis,
      opts,
      legacyCustomKey,
    );
  }

  async addRepeatableJob(
    customKey: string,
    nextMillis: number,
    opts: RepeatableOptions,
    legacyCustomKey: string,
  ): Promise<string> {
    return this.schedulerScripts.addRepeatableJob(
      customKey,
      nextMillis,
      opts,
      legacyCustomKey,
    );
  }

  async updateRepeatableJobMillis(
    client: RedisClient,
    customKey: string,
    nextMillis: number,
    legacyCustomKey: string,
  ): Promise<string> {
    return this.schedulerScripts.updateRepeatableJobMillis(
      client,
      customKey,
      nextMillis,
      legacyCustomKey,
    );
  }

  async removeRepeatable(
    legacyRepeatJobId: string,
    repeatConcatOptions: string,
    repeatJobKey: string,
  ): Promise<number> {
    return this.schedulerScripts.removeRepeatable(
      legacyRepeatJobId,
      repeatConcatOptions,
      repeatJobKey,
    );
  }

  getRepeatConcatOptions(repeatConcatOptions: string, repeatJobKey: string) {
    return this.schedulerScripts.getRepeatConcatOptions(
      repeatConcatOptions,
      repeatJobKey,
    );
  }

  async addJobScheduler(
    jobSchedulerId: string,
    nextMillis: number,
    templateData: string,
    templateOpts: RedisJobOptions,
    opts: RepeatableOptions,
    delayedJobOpts: JobsOptions,
    producerId?: string,
  ): Promise<[string, number]> {
    return this.schedulerScripts.addJobScheduler(
      jobSchedulerId,
      nextMillis,
      templateData,
      templateOpts,
      opts,
      delayedJobOpts,
      producerId,
    );
  }

  async updateJobSchedulerNextMillis(
    jobSchedulerId: string,
    nextMillis: number,
    templateData: string,
    delayedJobOpts: JobsOptions,
    producerId?: string,
  ): Promise<string | null> {
    return this.schedulerScripts.updateJobSchedulerNextMillis(
      jobSchedulerId,
      nextMillis,
      templateData,
      delayedJobOpts,
      producerId,
    );
  }

  async removeJobScheduler(jobSchedulerId: string): Promise<number> {
    return this.schedulerScripts.removeJobScheduler(jobSchedulerId);
  }

  getJobSchedulerArgs(id: string): string[] {
    return this.schedulerScripts.getJobSchedulerArgs(id);
  }

  async getJobScheduler(id: string): Promise<[any, string | null]> {
    return this.schedulerScripts.getJobScheduler(id);
  }

  // Worker domain methods

  async extendLock(
    jobId: string,
    token: string,
    duration: number,
    client?: RedisClient | ChainableCommander,
  ): Promise<number> {
    return this.workerScripts.extendLock(jobId, token, duration, client);
  }

  async extendLocks(
    jobIds: string[],
    tokens: string[],
    duration: number,
  ): Promise<string[]> {
    return this.workerScripts.extendLocks(jobIds, tokens, duration);
  }

  async moveToActive(client: RedisClient, token: string, name?: string) {
    return this.workerScripts.moveToActive(client, token, name);
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
    return this.workerScripts.moveToFinishedArgs(
      job,
      val,
      propVal,
      shouldRemove,
      target,
      token,
      timestamp,
      fetchNext,
      fieldsToUpdate,
    );
  }

  moveToCompletedArgs<T = any, R = any, N extends string = string>(
    job: MinimalJob<T, R, N>,
    returnvalue: R,
    removeOnComplete: boolean | number | KeepJobs,
    token: string,
    fetchNext = false,
  ): (string | number | boolean | Buffer)[] {
    return this.workerScripts.moveToCompletedArgs(
      job,
      returnvalue,
      removeOnComplete,
      token,
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
    return this.workerScripts.moveToFailedArgs(
      job,
      failedReason,
      removeOnFailed,
      token,
      fetchNext,
      fieldsToUpdate,
    );
  }

  async moveToFinished(
    jobId: string,
    args: (string | number | boolean | Buffer)[],
  ) {
    return this.workerScripts.moveToFinished(jobId, args);
  }

  moveToDelayedArgs(
    jobId: string,
    timestamp: number,
    token: string,
    delay: number,
    opts: MoveToDelayedOpts = {},
  ): (string | number | Buffer)[] {
    return this.workerScripts.moveToDelayedArgs(
      jobId,
      timestamp,
      token,
      delay,
      opts,
    );
  }

  async moveToDelayed(
    jobId: string,
    timestamp: number,
    delay: number,
    token = '0',
    opts: MoveToDelayedOpts = {},
  ): Promise<void> {
    return this.workerScripts.moveToDelayed(
      jobId,
      timestamp,
      delay,
      token,
      opts,
    );
  }

  protected moveStalledJobsToWaitArgs(): (string | number)[] {
    return this.workerScripts.moveStalledJobsToWaitArgs();
  }

  async moveStalledJobsToWait(): Promise<string[]> {
    return this.workerScripts.moveStalledJobsToWait();
  }

  async retryJobs(
    state: FinishedStatus = 'failed',
    count = 1000,
    timestamp = new Date().getTime(),
  ): Promise<number> {
    return this.workerScripts.retryJobs(state, count, timestamp);
  }

  async promoteJobs(count = 1000): Promise<number> {
    return this.workerScripts.promoteJobs(count);
  }

  protected moveJobsToWaitArgs(
    state: FinishedStatus | 'delayed',
    count: number,
    timestamp: number,
  ): (string | number)[] {
    return this.workerScripts.moveJobsToWaitArgs(state, count, timestamp);
  }
}
