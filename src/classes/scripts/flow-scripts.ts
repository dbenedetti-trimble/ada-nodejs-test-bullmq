import { MoveToWaitingChildrenOpts } from '../../interfaces';
import { getParentKey } from '../../utils';
import { ScriptContext, finishedErrors } from './script-utils';

export class FlowScripts {
  constructor(private ctx: ScriptContext) {}

  private removeChildDependencyArgs(
    jobId: string,
    parentKey: string,
  ): (string | number)[] {
    const queueKeys = this.ctx.keys;

    const keys: string[] = [queueKeys['']];

    const args = [this.ctx.toKey(jobId), parentKey];

    return keys.concat(args);
  }

  async removeChildDependency(
    jobId: string,
    parentKey: string,
  ): Promise<boolean> {
    const client = await this.ctx.client;
    const args = this.removeChildDependencyArgs(jobId, parentKey);

    const result = await this.ctx.execCommand(
      client,
      'removeChildDependency',
      args,
    );

    switch (result) {
      case 0:
        return true;
      case 1:
        return false;
      default:
        throw finishedErrors({
          code: result,
          jobId,
          parentKey,
          command: 'removeChildDependency',
        });
    }
  }

  moveToWaitingChildrenArgs(
    jobId: string,
    token: string,
    opts?: MoveToWaitingChildrenOpts,
  ): (string | number)[] {
    const timestamp = Date.now();

    const childKey = getParentKey(opts.child);

    const keys: (string | number)[] = [
      'active',
      'waiting-children',
      jobId,
      `${jobId}:dependencies`,
      `${jobId}:unsuccessful`,
      'stalled',
      'events',
    ].map(name => {
      return this.ctx.toKey(name);
    });

    return keys.concat([
      token,
      childKey ?? '',
      JSON.stringify(timestamp),
      jobId,
      this.ctx.toKey(''),
    ]);
  }

  async moveToWaitingChildren(
    jobId: string,
    token: string,
    opts: MoveToWaitingChildrenOpts = {},
  ): Promise<boolean> {
    const client = await this.ctx.client;

    const args = this.moveToWaitingChildrenArgs(jobId, token, opts);
    const result = await this.ctx.execCommand(
      client,
      'moveToWaitingChildren',
      args,
    );

    switch (result) {
      case 0:
        return true;
      case 1:
        return false;
      default:
        throw finishedErrors({
          code: result,
          jobId,
          command: 'moveToWaitingChildren',
          state: 'active',
        });
    }
  }

  protected getDependencyCountsArgs(
    jobId: string,
    types: string[],
  ): (string | number)[] {
    const keys: string[] = [
      `${jobId}:processed`,
      `${jobId}:dependencies`,
      `${jobId}:failed`,
      `${jobId}:unsuccessful`,
    ].map(name => {
      return this.ctx.toKey(name);
    });

    const args = types;

    return keys.concat(args);
  }

  async getDependencyCounts(
    jobId: string,
    types: string[],
  ): Promise<number[]> {
    const client = await this.ctx.client;
    const args = this.getDependencyCountsArgs(jobId, types);

    return await this.ctx.execCommand(client, 'getDependencyCounts', args);
  }
}
