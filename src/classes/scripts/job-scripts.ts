'use strict';
import {
  JobJson,
  MinimalJob,
  ParentKeyOpts,
  RedisClient,
  RetryJobOpts,
  RetryOptions,
} from '../../interfaces';
import {
  JobState,
  JobProgress,
  RedisJobOptions,
  KeepJobs,
} from '../../types';
import { ScriptContext } from './script-utils';
import { ChainableCommander } from 'ioredis';

export class JobScripts {
  constructor(private ctx: ScriptContext) {}

  async addJob(
    client: RedisClient,
    job: JobJson,
    opts: RedisJobOptions,
    jobId: string,
    parentKeyOpts: ParentKeyOpts = {},
  ): Promise<string> {
    throw new Error('stub: not yet implemented');
  }

  protected addStandardJob(
    client: RedisClient,
    job: JobJson,
    encodedOpts: any,
    args: (string | number | Record<string, any>)[],
  ): Promise<string | number> {
    throw new Error('stub: not yet implemented');
  }

  protected addDelayedJob(
    client: RedisClient,
    job: JobJson,
    encodedOpts: any,
    args: (string | number | Record<string, any>)[],
  ): Promise<string | number> {
    throw new Error('stub: not yet implemented');
  }

  protected addPrioritizedJob(
    client: RedisClient,
    job: JobJson,
    encodedOpts: any,
    args: (string | number | Record<string, any>)[],
  ): Promise<string | number> {
    throw new Error('stub: not yet implemented');
  }

  protected addParentJob(
    client: RedisClient,
    job: JobJson,
    encodedOpts: any,
    args: (string | number | Record<string, any>)[],
  ): Promise<string | number> {
    throw new Error('stub: not yet implemented');
  }

  protected addStandardJobArgs(
    job: JobJson,
    encodedOpts: any,
    args: (string | number | Record<string, any>)[],
  ): (string | Buffer)[] {
    throw new Error('stub: not yet implemented');
  }

  protected addDelayedJobArgs(
    job: JobJson,
    encodedOpts: any,
    args: (string | number | Record<string, any>)[],
  ): (string | Buffer)[] {
    throw new Error('stub: not yet implemented');
  }

  protected addPrioritizedJobArgs(
    job: JobJson,
    encodedOpts: any,
    args: (string | number | Record<string, any>)[],
  ): (string | Buffer)[] {
    throw new Error('stub: not yet implemented');
  }

  protected addParentJobArgs(
    job: JobJson,
    encodedOpts: any,
    args: (string | number | Record<string, any>)[],
  ): (string | Buffer)[] {
    throw new Error('stub: not yet implemented');
  }

  async remove(jobId: string, removeChildren: boolean): Promise<number> {
    throw new Error('stub: not yet implemented');
  }

  async removeUnprocessedChildren(jobId: string): Promise<void> {
    throw new Error('stub: not yet implemented');
  }

  async updateData<T = any, R = any, N extends string = string>(
    job: MinimalJob<T, R, N>,
    data: T,
  ): Promise<void> {
    throw new Error('stub: not yet implemented');
  }

  async updateProgress(jobId: string, progress: JobProgress): Promise<void> {
    throw new Error('stub: not yet implemented');
  }

  async addLog(
    jobId: string,
    logRow: string,
    keepLogs?: number,
  ): Promise<number> {
    throw new Error('stub: not yet implemented');
  }

  async isFinished(
    jobId: string,
    returnValue?: boolean,
  ): Promise<number | [number, string]> {
    throw new Error('stub: not yet implemented');
  }

  async getState(jobId: string): Promise<JobState | 'unknown'> {
    throw new Error('stub: not yet implemented');
  }

  async changeDelay(jobId: string, delay: number): Promise<void> {
    throw new Error('stub: not yet implemented');
  }

  async changePriority(
    jobId: string,
    priority?: number,
    lifo?: boolean,
  ): Promise<void> {
    throw new Error('stub: not yet implemented');
  }

  protected changePriorityArgs(
    jobId: string,
    priority?: number,
    lifo?: boolean,
  ): (string | number)[] {
    throw new Error('stub: not yet implemented');
  }

  async retryJob(
    jobId: string,
    lifo: boolean,
    token?: string,
    opts?: RetryJobOpts,
  ): Promise<void> {
    throw new Error('stub: not yet implemented');
  }

  retryJobArgs(
    jobId: string,
    lifo: boolean,
    token: string,
    opts?: { fieldsToUpdate?: Record<string, any> },
  ): (string | number | Buffer)[] {
    throw new Error('stub: not yet implemented');
  }

  async reprocessJob<T = any, R = any, N extends string = string>(
    job: MinimalJob<T, R, N>,
    state: 'failed' | 'completed',
    opts?: RetryOptions,
  ): Promise<void> {
    throw new Error('stub: not yet implemented');
  }

  async promote(jobId: string): Promise<void> {
    throw new Error('stub: not yet implemented');
  }

  async removeDeduplicationKey(
    deduplicationId: string,
    jobId: string,
  ): Promise<number> {
    throw new Error('stub: not yet implemented');
  }
}
