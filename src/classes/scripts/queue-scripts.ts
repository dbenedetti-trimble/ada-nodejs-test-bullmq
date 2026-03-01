'use strict';
import { JobType, JobJsonRaw } from '../../types';
import { ScriptContext } from './script-utils';

export class QueueScripts {
  constructor(private ctx: ScriptContext) {}

  protected pauseArgs(pause: boolean): (string | number)[] {
    throw new Error('stub: not yet implemented');
  }

  async pause(pause: boolean): Promise<void> {
    throw new Error('stub: not yet implemented');
  }

  async drain(delayed: boolean): Promise<void> {
    throw new Error('stub: not yet implemented');
  }

  async obliterate(opts: { force: boolean; count: number }): Promise<number> {
    throw new Error('stub: not yet implemented');
  }

  async getRanges(
    types: JobType[],
    start?: number,
    end?: number,
    asc?: boolean,
  ): Promise<[string][]> {
    throw new Error('stub: not yet implemented');
  }

  async getCounts(types: JobType[]): Promise<number[]> {
    throw new Error('stub: not yet implemented');
  }

  async getCountsPerPriority(priorities: number[]): Promise<number[]> {
    throw new Error('stub: not yet implemented');
  }

  protected getCountsPerPriorityArgs(
    priorities: number[],
  ): (string | number)[] {
    throw new Error('stub: not yet implemented');
  }

  getRateLimitTtlArgs(maxJobs?: number): (string | number)[] {
    throw new Error('stub: not yet implemented');
  }

  async getRateLimitTtl(maxJobs?: number): Promise<number> {
    throw new Error('stub: not yet implemented');
  }

  isMaxedArgs(): string[] {
    throw new Error('stub: not yet implemented');
  }

  async isMaxed(): Promise<boolean> {
    throw new Error('stub: not yet implemented');
  }

  async cleanJobsInSet(
    set: string,
    timestamp: number,
    limit?: number,
  ): Promise<string[]> {
    throw new Error('stub: not yet implemented');
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
    throw new Error('stub: not yet implemented');
  }

  async moveJobFromActiveToWait(jobId: string, token?: string): Promise<any> {
    throw new Error('stub: not yet implemented');
  }

  async getMetrics(
    type: 'completed' | 'failed',
    start?: number,
    end?: number,
  ): Promise<[string[], string[], number]> {
    throw new Error('stub: not yet implemented');
  }
}
