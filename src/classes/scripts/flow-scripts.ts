import { MoveToWaitingChildrenOpts } from '../../interfaces';
import { ScriptContext } from './script-utils';

export class FlowScripts {
  constructor(private ctx: ScriptContext) {}

  async removeChildDependency(
    jobId: string,
    parentKey: string,
  ): Promise<boolean> {
    return undefined as any;
  }

  moveToWaitingChildrenArgs(
    jobId: string,
    token: string,
    opts?: MoveToWaitingChildrenOpts,
  ): (string | number)[] {
    return [] as any;
  }

  async moveToWaitingChildren(
    jobId: string,
    token: string,
    opts?: MoveToWaitingChildrenOpts,
  ): Promise<boolean> {
    return undefined as any;
  }

  getDependencyCountsArgs(
    jobId: string,
    types: string[],
  ): (string | number)[] {
    return [] as any;
  }

  async getDependencyCounts(
    jobId: string,
    types: string[],
  ): Promise<number[]> {
    return undefined as any;
  }
}
