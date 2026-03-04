/**
 * Flow/dependency operations: child dependencies, waiting-children transitions.
 */

import { MoveToWaitingChildrenOpts, RedisClient } from '../../interfaces';
import { ScriptContext } from './script-utils';

export class FlowScripts {
  constructor(private ctx: ScriptContext) {}

  async removeChildDependency(
    jobId: string,
    parentKey: string,
  ): Promise<boolean> {
    // TODO: implement in features pass
    throw new Error('Not implemented');
  }

  private removeChildDependencyArgs(
    jobId: string,
    parentKey: string,
  ): (string | number)[] {
    // TODO: implement in features pass
    throw new Error('Not implemented');
  }

  moveToWaitingChildrenArgs(
    jobId: string,
    token: string,
    opts?: MoveToWaitingChildrenOpts,
  ): (string | number)[] {
    // TODO: implement in features pass
    throw new Error('Not implemented');
  }

  async moveToWaitingChildren(
    jobId: string,
    token: string,
    opts?: MoveToWaitingChildrenOpts,
  ): Promise<boolean> {
    // TODO: implement in features pass
    throw new Error('Not implemented');
  }

  public getDependencyCountsArgs(
    jobId: string,
    types: string[],
  ): (string | number)[] {
    // TODO: implement in features pass
    throw new Error('Not implemented');
  }

  async getDependencyCounts(
    jobId: string,
    types: string[],
  ): Promise<number[]> {
    // TODO: implement in features pass
    throw new Error('Not implemented');
  }
}
