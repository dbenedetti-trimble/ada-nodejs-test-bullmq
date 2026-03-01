'use strict';
import { MoveToWaitingChildrenOpts } from '../../interfaces';
import { ScriptContext } from './script-utils';

export class FlowScripts {
  constructor(private ctx: ScriptContext) {}

  async removeChildDependency(
    jobId: string,
    parentKey: string,
  ): Promise<boolean> {
    throw new Error('stub: not yet implemented');
  }

  async moveToWaitingChildren(
    jobId: string,
    token: string,
    opts?: MoveToWaitingChildrenOpts,
  ): Promise<boolean> {
    throw new Error('stub: not yet implemented');
  }

  moveToWaitingChildrenArgs(
    jobId: string,
    token: string,
    opts?: MoveToWaitingChildrenOpts,
  ): (string | number)[] {
    throw new Error('stub: not yet implemented');
  }

  async getDependencyCounts(jobId: string, types: string[]): Promise<number[]> {
    throw new Error('stub: not yet implemented');
  }
}
