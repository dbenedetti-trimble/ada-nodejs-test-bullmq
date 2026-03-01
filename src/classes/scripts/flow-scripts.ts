import { MoveToWaitingChildrenOpts } from '../../interfaces';
import { ScriptContext } from './script-utils';

export class FlowScripts {
  constructor(private ctx: ScriptContext) {}

  private removeChildDependencyArgs(
    _jobId: string,
    _parentKey: string,
  ): (string | number)[] {
    throw new Error('stub');
  }

  async removeChildDependency(
    _jobId: string,
    _parentKey: string,
  ): Promise<boolean> {
    throw new Error('stub');
  }

  moveToWaitingChildrenArgs(
    _jobId: string,
    _token: string,
    _opts?: MoveToWaitingChildrenOpts,
  ): (string | number)[] {
    throw new Error('stub');
  }

  async moveToWaitingChildren(
    _jobId: string,
    _token: string,
    _opts?: MoveToWaitingChildrenOpts,
  ): Promise<boolean> {
    throw new Error('stub');
  }

  protected getDependencyCountsArgs(
    _jobId: string,
    _types: string[],
  ): (string | number)[] {
    throw new Error('stub');
  }

  async getDependencyCounts(
    _jobId: string,
    _types: string[],
  ): Promise<number[]> {
    throw new Error('stub');
  }

  private _getCtx(): ScriptContext {
    return this.ctx;
  }
}
