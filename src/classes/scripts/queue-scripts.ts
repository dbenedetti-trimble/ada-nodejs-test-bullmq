import { JobJsonRaw } from '../../interfaces';
import { JobType } from '../../types';
import { ScriptContext } from './script-utils';

export class QueueScripts {
  constructor(private ctx: ScriptContext) {}

  protected pauseArgs(_pause: boolean): (string | number)[] {
    throw new Error('stub');
  }

  async pause(_pause: boolean): Promise<void> {
    throw new Error('stub');
  }

  private drainArgs(_delayed: boolean): (string | number)[] {
    throw new Error('stub');
  }

  async drain(_delayed: boolean): Promise<void> {
    throw new Error('stub');
  }

  async obliterate(_opts: { force: boolean; count: number }): Promise<number> {
    throw new Error('stub');
  }

  private getRangesArgs(
    _types: JobType[],
    _start: number,
    _end: number,
    _asc: boolean,
  ): (string | number)[] {
    throw new Error('stub');
  }

  async getRanges(
    _types: JobType[],
    _start?: number,
    _end?: number,
    _asc?: boolean,
  ): Promise<[string][]> {
    throw new Error('stub');
  }

  private getCountsArgs(_types: JobType[]): (string | number)[] {
    throw new Error('stub');
  }

  async getCounts(_types: JobType[]): Promise<number[]> {
    throw new Error('stub');
  }

  protected getCountsPerPriorityArgs(
    _priorities: number[],
  ): (string | number)[] {
    throw new Error('stub');
  }

  async getCountsPerPriority(_priorities: number[]): Promise<number[]> {
    throw new Error('stub');
  }

  getRateLimitTtlArgs(_maxJobs?: number): (string | number)[] {
    throw new Error('stub');
  }

  async getRateLimitTtl(_maxJobs?: number): Promise<number> {
    throw new Error('stub');
  }

  isMaxedArgs(): string[] {
    throw new Error('stub');
  }

  async isMaxed(): Promise<boolean> {
    throw new Error('stub');
  }

  async cleanJobsInSet(
    _set: string,
    _timestamp: number,
    _limit?: number,
  ): Promise<string[]> {
    throw new Error('stub');
  }

  async paginate(
    _key: string,
    _opts: { start: number; end: number; fetchJobs?: boolean },
  ): Promise<{
    cursor: string;
    items: { id: string; v?: any; err?: string }[];
    total: number;
    jobs?: JobJsonRaw[];
  }> {
    throw new Error('stub');
  }

  async moveJobFromActiveToWait(
    _jobId: string,
    _token?: string,
  ): Promise<any> {
    throw new Error('stub');
  }

  async getMetrics(
    _type: 'completed' | 'failed',
    _start?: number,
    _end?: number,
  ): Promise<[string[], string[], number]> {
    throw new Error('stub');
  }

  private _getCtx(): ScriptContext {
    return this.ctx;
  }
}
