'use strict';
import { RedisClient, RepeatableOptions } from '../../interfaces';
import { JobsOptions, RedisJobOptions } from '../../types';
import { ScriptContext, finishedErrors, pack } from './script-utils';

export class SchedulerScripts {
  constructor(private ctx: ScriptContext) {}

  protected addRepeatableJobArgs(
    customKey: string,
    nextMillis: number,
    opts: RepeatableOptions,
    legacyCustomKey: string,
  ): (string | number | Buffer)[] {
    const queueKeys = this.ctx.keys;
    const keys: (string | number | Buffer)[] = [
      queueKeys.repeat,
      queueKeys.delayed,
    ];

    const args = [
      nextMillis,
      pack(opts),
      legacyCustomKey,
      customKey,
      queueKeys[''],
    ];

    return keys.concat(args);
  }

  async addRepeatableJob(
    customKey: string,
    nextMillis: number,
    opts: RepeatableOptions,
    legacyCustomKey: string,
  ): Promise<string> {
    const client = await this.ctx.client;

    const args = this.addRepeatableJobArgs(
      customKey,
      nextMillis,
      opts,
      legacyCustomKey,
    );
    return this.ctx.execCommand(client, 'addRepeatableJob', args);
  }

  async updateRepeatableJobMillis(
    client: RedisClient,
    customKey: string,
    nextMillis: number,
    legacyCustomKey: string,
  ): Promise<string> {
    const args = [this.ctx.keys.repeat, nextMillis, customKey, legacyCustomKey];
    return this.ctx.execCommand(client, 'updateRepeatableJobMillis', args);
  }

  private removeRepeatableArgs(
    legacyRepeatJobId: string,
    repeatConcatOptions: string,
    repeatJobKey: string,
  ): string[] {
    const queueKeys = this.ctx.keys;

    const keys = [queueKeys.repeat, queueKeys.delayed, queueKeys.events];

    const args = [
      legacyRepeatJobId,
      this.getRepeatConcatOptions(repeatConcatOptions, repeatJobKey),
      repeatJobKey,
      queueKeys[''],
    ];

    return keys.concat(args);
  }

  getRepeatConcatOptions(
    repeatConcatOptions: string,
    repeatJobKey: string,
  ): string {
    if (repeatJobKey && repeatJobKey.split(':').length > 2) {
      return repeatJobKey;
    }

    return repeatConcatOptions;
  }

  async removeRepeatable(
    legacyRepeatJobId: string,
    repeatConcatOptions: string,
    repeatJobKey: string,
  ): Promise<number> {
    const client = await this.ctx.client;
    const args = this.removeRepeatableArgs(
      legacyRepeatJobId,
      repeatConcatOptions,
      repeatJobKey,
    );
    return this.ctx.execCommand(client, 'removeRepeatable', args);
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
    const client = await this.ctx.client;
    const queueKeys = this.ctx.keys;

    const keys: (string | number | Buffer)[] = [
      queueKeys.repeat,
      queueKeys.delayed,
      queueKeys.wait,
      queueKeys.paused,
      queueKeys.meta,
      queueKeys.prioritized,
      queueKeys.marker,
      queueKeys.id,
      queueKeys.events,
      queueKeys.pc,
      queueKeys.active,
    ];

    const args = [
      nextMillis,
      pack(opts),
      jobSchedulerId,
      templateData,
      pack(templateOpts),
      pack(delayedJobOpts),
      Date.now(),
      queueKeys[''],
      producerId ? this.ctx.toKey(producerId) : '',
    ];

    const result = await this.ctx.execCommand(
      client,
      'addJobScheduler',
      keys.concat(args),
    );

    if (typeof result === 'number' && result < 0) {
      throw finishedErrors({
        code: result,
        command: 'addJobScheduler',
      });
    }

    return result;
  }

  async updateJobSchedulerNextMillis(
    jobSchedulerId: string,
    nextMillis: number,
    templateData: string,
    delayedJobOpts: JobsOptions,
    producerId?: string,
  ): Promise<string | null> {
    const client = await this.ctx.client;

    const queueKeys = this.ctx.keys;

    const keys: (string | number | Buffer)[] = [
      queueKeys.repeat,
      queueKeys.delayed,
      queueKeys.wait,
      queueKeys.paused,
      queueKeys.meta,
      queueKeys.prioritized,
      queueKeys.marker,
      queueKeys.id,
      queueKeys.events,
      queueKeys.pc,
      producerId ? this.ctx.toKey(producerId) : '',
      queueKeys.active,
    ];

    const args = [
      nextMillis,
      jobSchedulerId,
      templateData,
      pack(delayedJobOpts),
      Date.now(),
      queueKeys[''],
      producerId,
    ];

    return this.ctx.execCommand(
      client,
      'updateJobScheduler',
      keys.concat(args),
    );
  }

  async removeJobScheduler(jobSchedulerId: string): Promise<number> {
    const client = await this.ctx.client;

    const queueKeys = this.ctx.keys;

    const keys = [queueKeys.repeat, queueKeys.delayed, queueKeys.events];

    const args = [jobSchedulerId, queueKeys['']];

    return this.ctx.execCommand(
      client,
      'removeJobScheduler',
      keys.concat(args),
    );
  }

  getJobSchedulerArgs(id: string): string[] {
    const keys: string[] = [this.ctx.keys.repeat];

    return keys.concat([id]);
  }

  async getJobScheduler(id: string): Promise<[any, string | null]> {
    const client = await this.ctx.client;

    const args = this.getJobSchedulerArgs(id);

    return this.ctx.execCommand(client, 'getJobScheduler', args);
  }
}
