'use strict';

import {
  JobJson,
  MinimalJob,
  ParentKeyOpts,
  RedisClient,
  MoveToDelayedOpts,
  RetryJobOpts,
  RetryOptions,
} from '../../interfaces';
import {
  JobState,
  RedisJobOptions,
  JobProgress,
} from '../../types';
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
    throw new Error('Not implemented: stub for features pass');
  }

  addStandardJob(
    client: RedisClient,
    job: JobJson,
    encodedOpts: any,
    args: (string | number | Record<string, any>)[],
  ): Promise<string | number> {
    throw new Error('Not implemented: stub for features pass');
  }

  addDelayedJob(
    client: RedisClient,
    job: JobJson,
    encodedOpts: any,
    args: (string | number | Record<string, any>)[],
  ): Promise<string | number> {
    throw new Error('Not implemented: stub for features pass');
  }

  addPrioritizedJob(
    client: RedisClient,
    job: JobJson,
    encodedOpts: any,
    args: (string | number | Record<string, any>)[],
  ): Promise<string | number> {
    throw new Error('Not implemented: stub for features pass');
  }

  addParentJob(
    client: RedisClient,
    job: JobJson,
    encodedOpts: any,
    args: (string | number | Record<string, any>)[],
  ): Promise<string | number> {
    throw new Error('Not implemented: stub for features pass');
  }

  addStandardJobArgs(
    job: JobJson,
    encodedOpts: any,
    args: (string | number | Record<string, any>)[],
  ): (string | Buffer)[] {
    throw new Error('Not implemented: stub for features pass');
  }

  addDelayedJobArgs(
    job: JobJson,
    encodedOpts: any,
    args: (string | number | Record<string, any>)[],
  ): (string | Buffer)[] {
    throw new Error('Not implemented: stub for features pass');
  }

  addPrioritizedJobArgs(
    job: JobJson,
    encodedOpts: any,
    args: (string | number | Record<string, any>)[],
  ): (string | Buffer)[] {
    throw new Error('Not implemented: stub for features pass');
  }

  addParentJobArgs(
    job: JobJson,
    encodedOpts: any,
    args: (string | number | Record<string, any>)[],
  ): (string | Buffer)[] {
    throw new Error('Not implemented: stub for features pass');
  }

  async remove(jobId: string, removeChildren: boolean): Promise<number> {
    throw new Error('Not implemented: stub for features pass');
  }

  async removeUnprocessedChildren(jobId: string): Promise<void> {
    throw new Error('Not implemented: stub for features pass');
  }

  async updateData<T = any, R = any, N extends string = string>(
    job: MinimalJob<T, R, N>,
    data: T,
  ): Promise<void> {
    throw new Error('Not implemented: stub for features pass');
  }

  async updateProgress(jobId: string, progress: JobProgress): Promise<void> {
    throw new Error('Not implemented: stub for features pass');
  }

  async addLog(
    jobId: string,
    logRow: string,
    keepLogs?: number,
  ): Promise<number> {
    throw new Error('Not implemented: stub for features pass');
  }

  async isFinished(
    jobId: string,
    returnValue = false,
  ): Promise<number | [number, string]> {
    throw new Error('Not implemented: stub for features pass');
  }

  async getState(jobId: string): Promise<JobState | 'unknown'> {
    throw new Error('Not implemented: stub for features pass');
  }

  async changeDelay(jobId: string, delay: number): Promise<void> {
    throw new Error('Not implemented: stub for features pass');
  }

  changePriorityArgs(
    jobId: string,
    priority = 0,
    lifo = false,
  ): (string | number)[] {
    throw new Error('Not implemented: stub for features pass');
  }

  async changePriority(
    jobId: string,
    priority = 0,
    lifo = false,
  ): Promise<void> {
    throw new Error('Not implemented: stub for features pass');
  }

  retryJobArgs(
    jobId: string,
    lifo: boolean,
    token: string,
    opts: MoveToDelayedOpts = {},
  ): (string | number | Buffer)[] {
    throw new Error('Not implemented: stub for features pass');
  }

  async retryJob(
    jobId: string,
    lifo: boolean,
    token = '0',
    opts: RetryJobOpts = {},
  ): Promise<void> {
    throw new Error('Not implemented: stub for features pass');
  }

  async reprocessJob<T = any, R = any, N extends string = string>(
    job: MinimalJob<T, R, N>,
    state: 'failed' | 'completed',
    opts: RetryOptions = {},
  ): Promise<void> {
    throw new Error('Not implemented: stub for features pass');
  }

  async promote(jobId: string): Promise<void> {
    throw new Error('Not implemented: stub for features pass');
  }

  async removeDeduplicationKey(
    deduplicationId: string,
    jobId: string,
  ): Promise<number> {
    throw new Error('Not implemented: stub for features pass');
  }
}
