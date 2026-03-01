import { RedisClient, RepeatableOptions } from '../../interfaces';
import { JobsOptions, RedisJobOptions } from '../../types';
import { ScriptContext } from './script-utils';

export class SchedulerScripts {
  constructor(private ctx: ScriptContext) {}

  protected addRepeatableJobArgs(
    _customKey: string,
    _nextMillis: number,
    _opts: RepeatableOptions,
    _legacyCustomKey: string,
  ): (string | number | Buffer)[] {
    throw new Error('stub');
  }

  async addRepeatableJob(
    _customKey: string,
    _nextMillis: number,
    _opts: RepeatableOptions,
    _legacyCustomKey: string,
  ): Promise<string> {
    throw new Error('stub');
  }

  async updateRepeatableJobMillis(
    _client: RedisClient,
    _customKey: string,
    _nextMillis: number,
    _legacyCustomKey: string,
  ): Promise<string> {
    throw new Error('stub');
  }

  private removeRepeatableArgs(
    _legacyRepeatJobId: string,
    _repeatConcatOptions: string,
    _repeatJobKey: string,
  ): string[] {
    throw new Error('stub');
  }

  getRepeatConcatOptions(
    _repeatConcatOptions: string,
    _repeatJobKey: string,
  ): string {
    throw new Error('stub');
  }

  async removeRepeatable(
    _legacyRepeatJobId: string,
    _repeatConcatOptions: string,
    _repeatJobKey: string,
  ): Promise<number> {
    throw new Error('stub');
  }

  async addJobScheduler(
    _jobSchedulerId: string,
    _nextMillis: number,
    _templateData: string,
    _templateOpts: RedisJobOptions,
    _opts: RepeatableOptions,
    _delayedJobOpts: JobsOptions,
    _producerId?: string,
  ): Promise<[string, number]> {
    throw new Error('stub');
  }

  async updateJobSchedulerNextMillis(
    _jobSchedulerId: string,
    _nextMillis: number,
    _templateData: string,
    _delayedJobOpts: JobsOptions,
    _producerId?: string,
  ): Promise<string | null> {
    throw new Error('stub');
  }

  async removeJobScheduler(_jobSchedulerId: string): Promise<number> {
    throw new Error('stub');
  }

  getJobSchedulerArgs(_id: string): string[] {
    throw new Error('stub');
  }

  async getJobScheduler(_id: string): Promise<[any, string | null]> {
    throw new Error('stub');
  }

  private _getCtx(): ScriptContext {
    return this.ctx;
  }
}
