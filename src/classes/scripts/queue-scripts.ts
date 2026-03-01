import { JobJsonRaw } from '../../interfaces';
import { JobType } from '../../types';
import { array2obj } from '../../utils';
import { ScriptContext, finishedErrors } from './script-utils';

export class QueueScripts {
  constructor(private ctx: ScriptContext) {}

  protected pauseArgs(pause: boolean): (string | number)[] {
    let src = 'wait',
      dst = 'paused';
    if (!pause) {
      src = 'paused';
      dst = 'wait';
    }

    const keys = [src, dst, 'meta', 'prioritized'].map((name: string) =>
      this.ctx.toKey(name),
    );

    keys.push(
      this.ctx.keys.events,
      this.ctx.keys.delayed,
      this.ctx.keys.marker,
    );

    const args = [pause ? 'paused' : 'resumed'];

    return keys.concat(args);
  }

  async pause(pause: boolean): Promise<void> {
    const client = await this.ctx.client;

    const args = this.pauseArgs(pause);
    return this.ctx.execCommand(client, 'pause', args);
  }

  private drainArgs(delayed: boolean): (string | number)[] {
    const queueKeys = this.ctx.keys;

    const keys: (string | number)[] = [
      queueKeys.wait,
      queueKeys.paused,
      queueKeys.delayed,
      queueKeys.prioritized,
      queueKeys.repeat,
    ];

    const args = [queueKeys[''], delayed ? '1' : '0'];

    return keys.concat(args);
  }

  async drain(delayed: boolean): Promise<void> {
    const client = await this.ctx.client;
    const args = this.drainArgs(delayed);

    return this.ctx.execCommand(client, 'drain', args);
  }

  async obliterate(opts: { force: boolean; count: number }): Promise<number> {
    const client = await this.ctx.client;

    const keys: (string | number)[] = [
      this.ctx.keys.meta,
      this.ctx.toKey(''),
    ];
    const args = [opts.count, opts.force ? 'force' : null];

    const result = await this.ctx.execCommand(
      client,
      'obliterate',
      keys.concat(args),
    );
    if (result < 0) {
      switch (result) {
        case -1:
          throw new Error('Cannot obliterate non-paused queue');
        case -2:
          throw new Error('Cannot obliterate queue with active jobs');
      }
    }
    return result;
  }

  private getRangesArgs(
    types: JobType[],
    start: number,
    end: number,
    asc: boolean,
  ): (string | number)[] {
    const queueKeys = this.ctx.keys;
    const transformedTypes = types.map(type => {
      return type === 'waiting' ? 'wait' : type;
    });

    const keys: (string | number)[] = [queueKeys['']];

    const args = [start, end, asc ? '1' : '0', ...transformedTypes];

    return keys.concat(args);
  }

  async getRanges(
    types: JobType[],
    start = 0,
    end = 1,
    asc = false,
  ): Promise<[string][]> {
    const client = await this.ctx.client;
    const args = this.getRangesArgs(types, start, end, asc);

    return await this.ctx.execCommand(client, 'getRanges', args);
  }

  private getCountsArgs(types: JobType[]): (string | number)[] {
    const queueKeys = this.ctx.keys;
    const transformedTypes = types.map(type => {
      return type === 'waiting' ? 'wait' : type;
    });

    const keys: (string | number)[] = [queueKeys['']];

    const args = [...transformedTypes];

    return keys.concat(args);
  }

  async getCounts(types: JobType[]): Promise<number[]> {
    const client = await this.ctx.client;
    const args = this.getCountsArgs(types);

    return await this.ctx.execCommand(client, 'getCounts', args);
  }

  protected getCountsPerPriorityArgs(
    priorities: number[],
  ): (string | number)[] {
    const keys: (string | number)[] = [
      this.ctx.keys.wait,
      this.ctx.keys.paused,
      this.ctx.keys.meta,
      this.ctx.keys.prioritized,
    ];

    const args = priorities;

    return keys.concat(args);
  }

  async getCountsPerPriority(priorities: number[]): Promise<number[]> {
    const client = await this.ctx.client;
    const args = this.getCountsPerPriorityArgs(priorities);

    return await this.ctx.execCommand(client, 'getCountsPerPriority', args);
  }

  getRateLimitTtlArgs(maxJobs?: number): (string | number)[] {
    const keys: (string | number)[] = [
      this.ctx.keys.limiter,
      this.ctx.keys.meta,
    ];

    return keys.concat([maxJobs ?? '0']);
  }

  async getRateLimitTtl(maxJobs?: number): Promise<number> {
    const client = await this.ctx.client;

    const args = this.getRateLimitTtlArgs(maxJobs);
    return this.ctx.execCommand(client, 'getRateLimitTtl', args);
  }

  isMaxedArgs(): string[] {
    const queueKeys = this.ctx.keys;
    const keys: string[] = [queueKeys.meta, queueKeys.active];

    return keys;
  }

  async isMaxed(): Promise<boolean> {
    const client = await this.ctx.client;

    const args = this.isMaxedArgs();
    return !!(await this.ctx.execCommand(client, 'isMaxed', args));
  }

  async cleanJobsInSet(
    set: string,
    timestamp: number,
    limit = 0,
  ): Promise<string[]> {
    const client = await this.ctx.client;

    return this.ctx.execCommand(client, 'cleanJobsInSet', [
      this.ctx.toKey(set),
      this.ctx.toKey('events'),
      this.ctx.toKey('repeat'),
      this.ctx.toKey(''),
      timestamp,
      limit,
      set,
    ]);
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
    const client = await this.ctx.client;

    const keys: (string | number)[] = [key];

    const maxIterations = 5;

    const pageSize = opts.end >= 0 ? opts.end - opts.start + 1 : Infinity;

    let cursor = '0',
      offset = 0,
      items,
      total,
      rawJobs,
      page: string[] = [],
      jobs: JobJsonRaw[] = [];
    do {
      const args = [
        opts.start + page.length,
        opts.end,
        cursor,
        offset,
        maxIterations,
      ];

      if (opts.fetchJobs) {
        args.push(1);
      }

      [cursor, offset, items, total, rawJobs] = await this.ctx.execCommand(
        client,
        'paginate',
        keys.concat(args),
      );

      page = page.concat(items);

      if (rawJobs && rawJobs.length) {
        jobs = jobs.concat(rawJobs.map(array2obj));
      }

      // Important to keep this coercive inequality (!=) instead of strict inequality (!==)
    } while (cursor != '0' && page.length < pageSize);

    // If we get an array of arrays, it means we are paginating a hash
    if (page.length && Array.isArray(page[0])) {
      const result = [];
      for (let index = 0; index < page.length; index++) {
        const [id, value] = page[index];
        try {
          result.push({ id, v: JSON.parse(value) });
        } catch (err) {
          result.push({ id, err: (<Error>err).message });
        }
      }

      return {
        cursor,
        items: result,
        total,
        jobs,
      };
    } else {
      return {
        cursor,
        items: page.map(item => ({ id: item })),
        total,
        jobs,
      };
    }
  }

  async moveJobFromActiveToWait(
    jobId: string,
    token = '0',
  ): Promise<any> {
    const client = await this.ctx.client;

    const keys: (string | number)[] = [
      this.ctx.keys.active,
      this.ctx.keys.wait,
      this.ctx.keys.stalled,
      this.ctx.keys.paused,
      this.ctx.keys.meta,
      this.ctx.keys.limiter,
      this.ctx.keys.prioritized,
      this.ctx.keys.marker,
      this.ctx.keys.events,
    ];

    const args = [jobId, token, this.ctx.toKey(jobId)];

    const result = await this.ctx.execCommand(
      client,
      'moveJobFromActiveToWait',
      keys.concat(args),
    );

    if (result < 0) {
      throw finishedErrors({
        code: result,
        jobId,
        command: 'moveJobFromActiveToWait',
        state: 'active',
      });
    }

    return result;
  }

  async getMetrics(
    type: 'completed' | 'failed',
    start = 0,
    end = -1,
  ): Promise<[string[], string[], number]> {
    const client = await this.ctx.client;

    const keys: (string | number)[] = [
      this.ctx.toKey(`metrics:${type}`),
      this.ctx.toKey(`metrics:${type}:data`),
    ];
    const args = [start, end];

    const result = await this.ctx.execCommand(
      client,
      'getMetrics',
      keys.concat(args),
    );

    return result;
  }
}
