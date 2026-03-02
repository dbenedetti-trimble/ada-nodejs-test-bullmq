'use strict';

import { JobJsonRaw, RedisClient } from '../../interfaces';
import { JobType } from '../../types';
import { ScriptContext } from './script-utils';

export class QueueScripts {
  constructor(private ctx: ScriptContext) {}

  pauseArgs(pause: boolean): (string | number)[] {
    throw new Error('Not implemented: stub for features pass');
  }

  async pause(pause: boolean): Promise<void> {
    throw new Error('Not implemented: stub for features pass');
  }

  async drain(delayed: boolean): Promise<void> {
    throw new Error('Not implemented: stub for features pass');
  }

  async obliterate(opts: { force: boolean; count: number }): Promise<number> {
    throw new Error('Not implemented: stub for features pass');
  }

  async getRanges(
    types: JobType[],
    start?: number,
    end?: number,
    asc?: boolean,
  ): Promise<[string][]> {
    throw new Error('Not implemented: stub for features pass');
  }

  async getCounts(types: JobType[]): Promise<number[]> {
    throw new Error('Not implemented: stub for features pass');
  }

  getCountsPerPriorityArgs(priorities: number[]): (string | number)[] {
    throw new Error('Not implemented: stub for features pass');
  }

  async getCountsPerPriority(priorities: number[]): Promise<number[]> {
    throw new Error('Not implemented: stub for features pass');
  }

  getRateLimitTtlArgs(maxJobs?: number): (string | number)[] {
    throw new Error('Not implemented: stub for features pass');
  }

  async getRateLimitTtl(maxJobs?: number): Promise<number> {
    throw new Error('Not implemented: stub for features pass');
  }

  isMaxedArgs(): string[] {
    throw new Error('Not implemented: stub for features pass');
  }

  async isMaxed(): Promise<boolean> {
    throw new Error('Not implemented: stub for features pass');
  }

  async cleanJobsInSet(
    set: string,
    timestamp: number,
    limit?: number,
  ): Promise<string[]> {
    throw new Error('Not implemented: stub for features pass');
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
    throw new Error('Not implemented: stub for features pass');
  }

  async moveJobFromActiveToWait(
    jobId: string,
    token?: string,
  ): Promise<any> {
    throw new Error('Not implemented: stub for features pass');
  }

  async getMetrics(
    type: 'completed' | 'failed',
    start?: number,
    end?: number,
  ): Promise<[string[], string[], number]> {
    throw new Error('Not implemented: stub for features pass');
  }
}
