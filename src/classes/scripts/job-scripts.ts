/**
 * Job domain operations: CRUD, state transitions, progress, retry, promote.
 */

import {
  JobJson,
  MinimalJob,
  ParentKeyOpts,
  RedisClient,
  RetryJobOpts,
  RetryOptions,
} from '../../interfaces';
import {
  FinishedPropValAttribute,
  JobProgress,
  JobState,
  KeepJobs,
  RedisJobOptions,
} from '../../types';
import { MoveToDelayedOpts } from '../../interfaces';
import { ScriptContext } from './script-utils';

export class JobScripts {
  constructor(private ctx: ScriptContext) {}

  async addJob(
    client: RedisClient,
    job: JobJson,
    opts: RedisJobOptions,
    jobId: string,
    parentKeyOpts: ParentKeyOpts = {},
  ): Promise<string> {
    // TODO: implement in features pass
    throw new Error('Not implemented');
  }

  public addStandardJob(
    client: RedisClient,
    job: JobJson,
    encodedOpts: any,
    args: (string | number | Record<string, any>)[],
  ): Promise<string | number> {
    // TODO: implement in features pass
    throw new Error('Not implemented');
  }

  public addStandardJobArgs(
    job: JobJson,
    encodedOpts: any,
    args: (string | number | Record<string, any>)[],
  ): (string | Buffer)[] {
    // TODO: implement in features pass
    throw new Error('Not implemented');
  }

  public addDelayedJob(
    client: RedisClient,
    job: JobJson,
    encodedOpts: any,
    args: (string | number | Record<string, any>)[],
  ): Promise<string | number> {
    // TODO: implement in features pass
    throw new Error('Not implemented');
  }

  public addDelayedJobArgs(
    job: JobJson,
    encodedOpts: any,
    args: (string | number | Record<string, any>)[],
  ): (string | Buffer)[] {
    // TODO: implement in features pass
    throw new Error('Not implemented');
  }

  public addPrioritizedJob(
    client: RedisClient,
    job: JobJson,
    encodedOpts: any,
    args: (string | number | Record<string, any>)[],
  ): Promise<string | number> {
    // TODO: implement in features pass
    throw new Error('Not implemented');
  }

  public addPrioritizedJobArgs(
    job: JobJson,
    encodedOpts: any,
    args: (string | number | Record<string, any>)[],
  ): (string | Buffer)[] {
    // TODO: implement in features pass
    throw new Error('Not implemented');
  }

  public addParentJob(
    client: RedisClient,
    job: JobJson,
    encodedOpts: any,
    args: (string | number | Record<string, any>)[],
  ): Promise<string | number> {
    // TODO: implement in features pass
    throw new Error('Not implemented');
  }

  public addParentJobArgs(
    job: JobJson,
    encodedOpts: any,
    args: (string | number | Record<string, any>)[],
  ): (string | Buffer)[] {
    // TODO: implement in features pass
    throw new Error('Not implemented');
  }

  async remove(
    jobId: string,
    removeChildren: boolean,
  ): Promise<number> {
    // TODO: implement in features pass
    throw new Error('Not implemented');
  }

  private removeArgs(
    jobId: string,
    removeChildren: boolean,
  ): (string | number)[] {
    // TODO: implement in features pass
    throw new Error('Not implemented');
  }

  async removeUnprocessedChildren(jobId: string): Promise<void> {
    // TODO: implement in features pass
    throw new Error('Not implemented');
  }

  async updateData<T = any, R = any, N extends string = string>(
    job: MinimalJob<T, R, N>,
    data: T,
  ): Promise<void> {
    // TODO: implement in features pass
    throw new Error('Not implemented');
  }

  async updateProgress(
    jobId: string,
    progress: JobProgress,
  ): Promise<void> {
    // TODO: implement in features pass
    throw new Error('Not implemented');
  }

  async addLog(
    jobId: string,
    logRow: string,
    keepLogs?: number,
  ): Promise<number> {
    // TODO: implement in features pass
    throw new Error('Not implemented');
  }

  async isFinished(
    jobId: string,
    returnValue?: boolean,
  ): Promise<number | [number, string]> {
    // TODO: implement in features pass
    throw new Error('Not implemented');
  }

  async getState(jobId: string): Promise<JobState | 'unknown'> {
    // TODO: implement in features pass
    throw new Error('Not implemented');
  }

  async changeDelay(jobId: string, delay: number): Promise<void> {
    // TODO: implement in features pass
    throw new Error('Not implemented');
  }

  private changeDelayArgs(
    jobId: string,
    delay: number,
  ): (string | number)[] {
    // TODO: implement in features pass
    throw new Error('Not implemented');
  }

  async changePriority(
    jobId: string,
    priority?: number,
    lifo?: boolean,
  ): Promise<void> {
    // TODO: implement in features pass
    throw new Error('Not implemented');
  }

  public changePriorityArgs(
    jobId: string,
    priority?: number,
    lifo?: boolean,
  ): (string | number)[] {
    // TODO: implement in features pass
    throw new Error('Not implemented');
  }

  async retryJob(
    jobId: string,
    lifo: boolean,
    token?: string,
    opts?: RetryJobOpts,
  ): Promise<void> {
    // TODO: implement in features pass
    throw new Error('Not implemented');
  }

  retryJobArgs(
    jobId: string,
    lifo: boolean,
    token: string,
    opts?: MoveToDelayedOpts,
  ): (string | number | Buffer)[] {
    // TODO: implement in features pass
    throw new Error('Not implemented');
  }

  async reprocessJob<T = any, R = any, N extends string = string>(
    job: MinimalJob<T, R, N>,
    state: 'failed' | 'completed',
    opts?: RetryOptions,
  ): Promise<void> {
    // TODO: implement in features pass
    throw new Error('Not implemented');
  }

  async promote(jobId: string): Promise<void> {
    // TODO: implement in features pass
    throw new Error('Not implemented');
  }

  async removeDeduplicationKey(
    deduplicationId: string,
    jobId: string,
  ): Promise<number> {
    // TODO: implement in features pass
    throw new Error('Not implemented');
  }
}
