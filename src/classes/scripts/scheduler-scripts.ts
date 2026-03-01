import { RedisClient, RepeatableOptions } from '../../interfaces';
import { JobsOptions, RedisJobOptions } from '../../types';
import { ScriptContext } from './script-utils';

export class SchedulerScripts {
  constructor(private ctx: ScriptContext) {}

  addRepeatableJobArgs(
    customKey: string,
    nextMillis: number,
    opts: RepeatableOptions,
    legacyCustomKey: string,
  ): (string | number | Buffer)[] {
    return [] as any;
  }

  async addRepeatableJob(
    customKey: string,
    nextMillis: number,
    opts: RepeatableOptions,
    legacyCustomKey: string,
  ): Promise<string> {
    return undefined as any;
  }

  async updateRepeatableJobMillis(
    client: RedisClient,
    customKey: string,
    nextMillis: number,
    legacyCustomKey: string,
  ): Promise<string> {
    return undefined as any;
  }

  async removeRepeatable(
    legacyRepeatJobId: string,
    repeatConcatOptions: string,
    repeatJobKey: string,
  ): Promise<number> {
    return undefined as any;
  }

  getRepeatConcatOptions(
    repeatConcatOptions: string,
    repeatJobKey: string,
  ): string {
    return undefined as any;
  }

  async addJobScheduler(
    jobSchedulerId: string,
    nextMillis: number,
    templateData: string,
    templateOpts: RedisJobOptions,
    opts: RepeatableOptions,
    delayedJobOpts: JobsOptions,
    producerId?: string,
  ): Promise<[string, number]> {
    return undefined as any;
  }

  async updateJobSchedulerNextMillis(
    jobSchedulerId: string,
    nextMillis: number,
    templateData: string,
    delayedJobOpts: JobsOptions,
    producerId?: string,
  ): Promise<string | null> {
    return undefined as any;
  }

  async removeJobScheduler(jobSchedulerId: string): Promise<number> {
    return undefined as any;
  }

  getJobSchedulerArgs(id: string): string[] {
    return [] as any;
  }

  async getJobScheduler(id: string): Promise<[any, string | null]> {
    return undefined as any;
  }
}
