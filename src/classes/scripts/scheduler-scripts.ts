'use strict';

import {
  RedisClient,
  RepeatableOptions,
} from '../../interfaces';
import {
  JobsOptions,
  RedisJobOptions,
} from '../../types';
import { ScriptContext } from './script-utils';

export class SchedulerScripts {
  constructor(private ctx: ScriptContext) {}

  addRepeatableJobArgs(
    customKey: string,
    nextMillis: number,
    opts: RepeatableOptions,
    legacyCustomKey: string,
  ): (string | number | Buffer)[] {
    throw new Error('Not implemented: stub for features pass');
  }

  async addRepeatableJob(
    customKey: string,
    nextMillis: number,
    opts: RepeatableOptions,
    legacyCustomKey: string,
  ): Promise<string> {
    throw new Error('Not implemented: stub for features pass');
  }

  async updateRepeatableJobMillis(
    client: RedisClient,
    customKey: string,
    nextMillis: number,
    legacyCustomKey: string,
  ): Promise<string> {
    throw new Error('Not implemented: stub for features pass');
  }

  getRepeatConcatOptions(
    repeatConcatOptions: string,
    repeatJobKey: string,
  ): string {
    throw new Error('Not implemented: stub for features pass');
  }

  async removeRepeatable(
    legacyRepeatJobId: string,
    repeatConcatOptions: string,
    repeatJobKey: string,
  ): Promise<number> {
    throw new Error('Not implemented: stub for features pass');
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
    throw new Error('Not implemented: stub for features pass');
  }

  async updateJobSchedulerNextMillis(
    jobSchedulerId: string,
    nextMillis: number,
    templateData: string,
    delayedJobOpts: JobsOptions,
    producerId?: string,
  ): Promise<string | null> {
    throw new Error('Not implemented: stub for features pass');
  }

  async removeJobScheduler(jobSchedulerId: string): Promise<number> {
    throw new Error('Not implemented: stub for features pass');
  }

  getJobSchedulerArgs(id: string): string[] {
    throw new Error('Not implemented: stub for features pass');
  }

  async getJobScheduler(id: string): Promise<[any, string | null]> {
    throw new Error('Not implemented: stub for features pass');
  }
}
