import { JobJsonRaw } from '../../interfaces';
import { JobType } from '../../types';
import { ScriptContext } from './script-utils';

export class QueueScripts {
  constructor(private ctx: ScriptContext) {}

  pauseArgs(pause: boolean): (string | number)[] {
    return [] as any;
  }

  async pause(pause: boolean): Promise<void> {
    return undefined as any;
  }

  async drain(delayed: boolean): Promise<void> {
    return undefined as any;
  }

  async obliterate(opts: { force: boolean; count: number }): Promise<number> {
    return undefined as any;
  }

  async getRanges(
    types: JobType[],
    start?: number,
    end?: number,
    asc?: boolean,
  ): Promise<[string][]> {
    return undefined as any;
  }

  async getCounts(types: JobType[]): Promise<number[]> {
    return undefined as any;
  }

  getCountsPerPriorityArgs(
    priorities: number[],
  ): (string | number)[] {
    return [] as any;
  }

  async getCountsPerPriority(priorities: number[]): Promise<number[]> {
    return undefined as any;
  }

  getRateLimitTtlArgs(maxJobs?: number): (string | number)[] {
    return [] as any;
  }

  async getRateLimitTtl(maxJobs?: number): Promise<number> {
    return undefined as any;
  }

  isMaxedArgs(): string[] {
    return [] as any;
  }

  async isMaxed(): Promise<boolean> {
    return undefined as any;
  }

  async cleanJobsInSet(
    set: string,
    timestamp: number,
    limit?: number,
  ): Promise<string[]> {
    return undefined as any;
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
    return undefined as any;
  }

  async moveJobFromActiveToWait(jobId: string, token?: string): Promise<any> {
    return undefined as any;
  }

  async getMetrics(
    type: 'completed' | 'failed',
    start?: number,
    end?: number,
  ): Promise<[string[], string[], number]> {
    return undefined as any;
  }
}
