/**
 * Scheduler and repeat operations: repeatable jobs, job schedulers.
 */

import { RedisClient, RepeatableOptions } from '../../interfaces';
import { JobsOptions, RedisJobOptions } from '../../types';
import { ScriptContext } from './script-utils';

export class SchedulerScripts {
  constructor(private ctx: ScriptContext) {}

  async addRepeatableJob(
    customKey: string,
    nextMillis: number,
    opts: RepeatableOptions,
    legacyCustomKey: string,
  ): Promise<string> {
    // TODO: implement in features pass
    throw new Error('Not implemented');
  }

  public addRepeatableJobArgs(
    customKey: string,
    nextMillis: number,
    opts: RepeatableOptions,
    legacyCustomKey: string,
  ): (string | number | Buffer)[] {
    // TODO: implement in features pass
    throw new Error('Not implemented');
  }

  async updateRepeatableJobMillis(
    client: RedisClient,
    customKey: string,
    nextMillis: number,
    legacyCustomKey: string,
  ): Promise<string> {
    // TODO: implement in features pass
    throw new Error('Not implemented');
  }

  async removeRepeatable(
    legacyRepeatJobId: string,
    repeatConcatOptions: string,
    repeatJobKey: string,
  ): Promise<number> {
    // TODO: implement in features pass
    throw new Error('Not implemented');
  }

  private removeRepeatableArgs(
    legacyRepeatJobId: string,
    repeatConcatOptions: string,
    repeatJobKey: string,
  ): string[] {
    // TODO: implement in features pass
    throw new Error('Not implemented');
  }

  getRepeatConcatOptions(
    repeatConcatOptions: string,
    repeatJobKey: string,
  ): string {
    // TODO: implement in features pass
    throw new Error('Not implemented');
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
    // TODO: implement in features pass
    throw new Error('Not implemented');
  }

  async updateJobSchedulerNextMillis(
    jobSchedulerId: string,
    nextMillis: number,
    templateData: string,
    delayedJobOpts: JobsOptions,
    producerId?: string,
  ): Promise<string | null> {
    // TODO: implement in features pass
    throw new Error('Not implemented');
  }

  async removeJobScheduler(
    jobSchedulerId: string,
  ): Promise<number> {
    // TODO: implement in features pass
    throw new Error('Not implemented');
  }

  getJobSchedulerArgs(id: string): string[] {
    // TODO: implement in features pass
    throw new Error('Not implemented');
  }

  async getJobScheduler(
    id: string,
  ): Promise<[any, string | null]> {
    // TODO: implement in features pass
    throw new Error('Not implemented');
  }
}
