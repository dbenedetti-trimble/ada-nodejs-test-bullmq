/**
 * Queue management operations: pause, drain, obliterate, counts, clean, paginate.
 */

import { JobJsonRaw, RedisClient } from '../../interfaces';
import { JobType } from '../../types';
import { ScriptContext } from './script-utils';

export class QueueScripts {
  constructor(private ctx: ScriptContext) {}

  async pause(pause: boolean): Promise<void> {
    // TODO: implement in features pass
    throw new Error('Not implemented');
  }

  public pauseArgs(pause: boolean): (string | number)[] {
    // TODO: implement in features pass
    throw new Error('Not implemented');
  }

  async drain(delayed: boolean): Promise<void> {
    // TODO: implement in features pass
    throw new Error('Not implemented');
  }

  private drainArgs(delayed: boolean): (string | number)[] {
    // TODO: implement in features pass
    throw new Error('Not implemented');
  }

  async obliterate(
    opts: { force: boolean; count: number },
  ): Promise<number> {
    // TODO: implement in features pass
    throw new Error('Not implemented');
  }

  async getRanges(
    types: JobType[],
    start?: number,
    end?: number,
    asc?: boolean,
  ): Promise<[string][]> {
    // TODO: implement in features pass
    throw new Error('Not implemented');
  }

  private getRangesArgs(
    types: JobType[],
    start: number,
    end: number,
    asc: boolean,
  ): (string | number)[] {
    // TODO: implement in features pass
    throw new Error('Not implemented');
  }

  async getCounts(types: JobType[]): Promise<number[]> {
    // TODO: implement in features pass
    throw new Error('Not implemented');
  }

  private getCountsArgs(types: JobType[]): (string | number)[] {
    // TODO: implement in features pass
    throw new Error('Not implemented');
  }

  public getCountsPerPriorityArgs(
    priorities: number[],
  ): (string | number)[] {
    // TODO: implement in features pass
    throw new Error('Not implemented');
  }

  async getCountsPerPriority(
    priorities: number[],
  ): Promise<number[]> {
    // TODO: implement in features pass
    throw new Error('Not implemented');
  }

  getRateLimitTtlArgs(maxJobs?: number): (string | number)[] {
    // TODO: implement in features pass
    throw new Error('Not implemented');
  }

  async getRateLimitTtl(maxJobs?: number): Promise<number> {
    // TODO: implement in features pass
    throw new Error('Not implemented');
  }

  isMaxedArgs(): string[] {
    // TODO: implement in features pass
    throw new Error('Not implemented');
  }

  async isMaxed(): Promise<boolean> {
    // TODO: implement in features pass
    throw new Error('Not implemented');
  }

  async cleanJobsInSet(
    set: string,
    timestamp: number,
    limit?: number,
  ): Promise<string[]> {
    // TODO: implement in features pass
    throw new Error('Not implemented');
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
    // TODO: implement in features pass
    throw new Error('Not implemented');
  }

  async moveJobFromActiveToWait(
    jobId: string,
    token?: string,
  ): Promise<any> {
    // TODO: implement in features pass
    throw new Error('Not implemented');
  }

  async getMetrics(
    type: 'completed' | 'failed',
    start?: number,
    end?: number,
  ): Promise<[string[], string[], number]> {
    // TODO: implement in features pass
    throw new Error('Not implemented');
  }
}
