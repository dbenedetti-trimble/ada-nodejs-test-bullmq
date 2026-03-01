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
  JobState,
  RedisJobOptions,
  JobProgress,
  KeepJobs,
} from '../../types';
import { ScriptContext } from './script-utils';

export class JobScripts {
  constructor(private ctx: ScriptContext) {}

  protected addStandardJobArgs(
    _job: JobJson,
    _encodedOpts: any,
    _args: (string | number | Record<string, any>)[],
  ): (string | Buffer)[] {
    throw new Error('stub');
  }

  protected addStandardJob(
    _client: RedisClient,
    _job: JobJson,
    _encodedOpts: any,
    _args: (string | number | Record<string, any>)[],
  ): Promise<string | number> {
    throw new Error('stub');
  }

  protected addDelayedJobArgs(
    _job: JobJson,
    _encodedOpts: any,
    _args: (string | number | Record<string, any>)[],
  ): (string | Buffer)[] {
    throw new Error('stub');
  }

  protected addDelayedJob(
    _client: RedisClient,
    _job: JobJson,
    _encodedOpts: any,
    _args: (string | number | Record<string, any>)[],
  ): Promise<string | number> {
    throw new Error('stub');
  }

  protected addPrioritizedJobArgs(
    _job: JobJson,
    _encodedOpts: any,
    _args: (string | number | Record<string, any>)[],
  ): (string | Buffer)[] {
    throw new Error('stub');
  }

  protected addPrioritizedJob(
    _client: RedisClient,
    _job: JobJson,
    _encodedOpts: any,
    _args: (string | number | Record<string, any>)[],
  ): Promise<string | number> {
    throw new Error('stub');
  }

  protected addParentJobArgs(
    _job: JobJson,
    _encodedOpts: any,
    _args: (string | number | Record<string, any>)[],
  ): (string | Buffer)[] {
    throw new Error('stub');
  }

  protected addParentJob(
    _client: RedisClient,
    _job: JobJson,
    _encodedOpts: any,
    _args: (string | number | Record<string, any>)[],
  ): Promise<string | number> {
    throw new Error('stub');
  }

  async addJob(
    _client: RedisClient,
    _job: JobJson,
    _opts: RedisJobOptions,
    _jobId: string,
    _parentKeyOpts: ParentKeyOpts = {},
  ): Promise<string> {
    throw new Error('stub');
  }

  private removeArgs(
    _jobId: string,
    _removeChildren: boolean,
  ): (string | number)[] {
    throw new Error('stub');
  }

  async remove(_jobId: string, _removeChildren: boolean): Promise<number> {
    throw new Error('stub');
  }

  async removeUnprocessedChildren(_jobId: string): Promise<void> {
    throw new Error('stub');
  }

  async updateData<T = any, R = any, N extends string = string>(
    _job: MinimalJob<T, R, N>,
    _data: T,
  ): Promise<void> {
    throw new Error('stub');
  }

  async updateProgress(_jobId: string, _progress: JobProgress): Promise<void> {
    throw new Error('stub');
  }

  async addLog(
    _jobId: string,
    _logRow: string,
    _keepLogs?: number,
  ): Promise<number> {
    throw new Error('stub');
  }

  async isFinished(
    _jobId: string,
    _returnValue?: boolean,
  ): Promise<number | [number, string]> {
    throw new Error('stub');
  }

  async getState(_jobId: string): Promise<JobState | 'unknown'> {
    throw new Error('stub');
  }

  async changeDelay(_jobId: string, _delay: number): Promise<void> {
    throw new Error('stub');
  }

  private changeDelayArgs(
    _jobId: string,
    _delay: number,
  ): (string | number)[] {
    throw new Error('stub');
  }

  async changePriority(
    _jobId: string,
    _priority?: number,
    _lifo?: boolean,
  ): Promise<void> {
    throw new Error('stub');
  }

  protected changePriorityArgs(
    _jobId: string,
    _priority?: number,
    _lifo?: boolean,
  ): (string | number)[] {
    throw new Error('stub');
  }

  retryJobArgs(
    _jobId: string,
    _lifo: boolean,
    _token: string,
    _opts?: MoveToDelayedOpts,
  ): (string | number | Buffer)[] {
    throw new Error('stub');
  }

  async retryJob(
    _jobId: string,
    _lifo: boolean,
    _token?: string,
    _opts?: RetryJobOpts,
  ): Promise<void> {
    throw new Error('stub');
  }

  async reprocessJob<T = any, R = any, N extends string = string>(
    _job: MinimalJob<T, R, N>,
    _state: 'failed' | 'completed',
    _opts?: RetryOptions,
  ): Promise<void> {
    throw new Error('stub');
  }

  async promote(_jobId: string): Promise<void> {
    throw new Error('stub');
  }

  async removeDeduplicationKey(
    _deduplicationId: string,
    _jobId: string,
  ): Promise<number> {
    throw new Error('stub');
  }

  // Suppress unused warning for ctx
  private _getCtx(): ScriptContext {
    return this.ctx;
  }
}
