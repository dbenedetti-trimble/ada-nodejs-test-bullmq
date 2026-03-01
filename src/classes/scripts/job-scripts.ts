import { ChainableCommander } from 'ioredis';
import {
  JobJson,
  MinimalJob,
  ParentKeyOpts,
  RedisClient,
  RetryJobOpts,
  RetryOptions,
  MoveToDelayedOpts,
} from '../../interfaces';
import {
  JobProgress,
  JobState,
  RedisJobOptions,
} from '../../types';
import { ScriptContext } from './script-utils';

export class JobScripts {
  constructor(private ctx: ScriptContext) {}

  async addJob(
    client: RedisClient,
    job: JobJson,
    opts: RedisJobOptions,
    jobId: string,
    parentKeyOpts: ParentKeyOpts,
  ): Promise<string> {
    return undefined as any;
  }

  addStandardJobArgs(
    job: JobJson,
    encodedOpts: any,
    args: (string | number | Record<string, any>)[],
  ): (string | Buffer)[] {
    return [] as any;
  }

  addStandardJob(
    client: RedisClient,
    job: JobJson,
    encodedOpts: any,
    args: (string | number | Record<string, any>)[],
  ): Promise<string | number> {
    return undefined as any;
  }

  addDelayedJobArgs(
    job: JobJson,
    encodedOpts: any,
    args: (string | number | Record<string, any>)[],
  ): (string | Buffer)[] {
    return [] as any;
  }

  addDelayedJob(
    client: RedisClient,
    job: JobJson,
    encodedOpts: any,
    args: (string | number | Record<string, any>)[],
  ): Promise<string | number> {
    return undefined as any;
  }

  addPrioritizedJobArgs(
    job: JobJson,
    encodedOpts: any,
    args: (string | number | Record<string, any>)[],
  ): (string | Buffer)[] {
    return [] as any;
  }

  addPrioritizedJob(
    client: RedisClient,
    job: JobJson,
    encodedOpts: any,
    args: (string | number | Record<string, any>)[],
  ): Promise<string | number> {
    return undefined as any;
  }

  addParentJobArgs(
    job: JobJson,
    encodedOpts: any,
    args: (string | number | Record<string, any>)[],
  ): (string | Buffer)[] {
    return [] as any;
  }

  addParentJob(
    client: RedisClient,
    job: JobJson,
    encodedOpts: any,
    args: (string | number | Record<string, any>)[],
  ): Promise<string | number> {
    return undefined as any;
  }

  async remove(jobId: string, removeChildren: boolean): Promise<number> {
    return undefined as any;
  }

  async removeUnprocessedChildren(jobId: string): Promise<void> {
    return undefined as any;
  }

  async updateData<T = any, R = any, N extends string = string>(
    job: MinimalJob<T, R, N>,
    data: T,
  ): Promise<void> {
    return undefined as any;
  }

  async updateProgress(jobId: string, progress: JobProgress): Promise<void> {
    return undefined as any;
  }

  async addLog(
    jobId: string,
    logRow: string,
    keepLogs?: number,
  ): Promise<number> {
    return undefined as any;
  }

  async isFinished(
    jobId: string,
    returnValue?: boolean,
  ): Promise<number | [number, string]> {
    return undefined as any;
  }

  async getState(jobId: string): Promise<JobState | 'unknown'> {
    return undefined as any;
  }

  async changeDelay(jobId: string, delay: number): Promise<void> {
    return undefined as any;
  }

  async changePriority(
    jobId: string,
    priority?: number,
    lifo?: boolean,
  ): Promise<void> {
    return undefined as any;
  }

  changePriorityArgs(
    jobId: string,
    priority?: number,
    lifo?: boolean,
  ): (string | number)[] {
    return [] as any;
  }

  retryJobArgs(
    jobId: string,
    lifo: boolean,
    token: string,
    opts?: MoveToDelayedOpts,
  ): (string | number | Buffer)[] {
    return [] as any;
  }

  async retryJob(
    jobId: string,
    lifo: boolean,
    token?: string,
    opts?: RetryJobOpts,
  ): Promise<void> {
    return undefined as any;
  }

  async reprocessJob<T = any, R = any, N extends string = string>(
    job: MinimalJob<T, R, N>,
    state: 'failed' | 'completed',
    opts?: RetryOptions,
  ): Promise<void> {
    return undefined as any;
  }

  async promote(jobId: string): Promise<void> {
    return undefined as any;
  }

  async removeDeduplicationKey(
    deduplicationId: string,
    jobId: string,
  ): Promise<number> {
    return undefined as any;
  }
}
