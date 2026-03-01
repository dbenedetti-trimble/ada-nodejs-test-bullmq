# Product Requirements Document (PRD)
**Repository**: `https://github.com/dbenedetti-trimble/ada-nodejs-test-bullmq`
**Branch**: `main`

---


# Scripts Class Domain Module Refactoring


## Context & Problem


### Problem statement

- **Who is affected?** BullMQ maintainers and contributors who need to understand, modify, or review the `Scripts` class -- the bridge between TypeScript and ~50 Redis Lua scripts.
- **What is the issue?** `src/classes/scripts.ts` is the largest file in the codebase at ~46KB with 80+ methods spanning five distinct domains: job operations, queue management, flow/dependency handling, scheduler/repeat logic, and worker/lock management. Methods for unrelated concerns are interleaved (e.g., `addJob` at line 233 is followed by `pause` at line 322, then `addRepeatableJob` at line 351). Finding, understanding, and modifying methods requires navigating the entire file. The class has grown organically as features were added and has no internal organization beyond chronological accumulation.
- **Why does it matter?** Large monolith files are a common real-world refactoring target. This PRD tests whether Ada can safely decompose a critical class without breaking any of the 30+ test files that exercise it. The refactoring is purely structural (no behavior changes), making the existing test suite a precise regression detector. Getting this right requires understanding method groupings, shared state dependencies, and the import graph of every consumer class.

### Success metrics


|         Metric          |      Baseline      |                          Target                          |         Validation method         |
| ----------------------- | ------------------ | -------------------------------------------------------- | --------------------------------- |
| `scripts.ts` file size  | ~46KB, 80+ methods | Facade with delegating methods only                      | File inspection                   |
| Domain module count     | 0 (monolith)       | 5 domain modules + 1 shared utils                        | File inspection                   |
| All existing tests pass | 100% pass          | 100% pass (zero regressions)                             | `npm test` with Redis             |
| TypeScript compiles     | Compiles           | Compiles with no new errors                              | `npm run tsc:all`                 |
| Lint clean              | Clean              | Clean                                                    | `npm run lint`                    |
| Public API unchanged    | N/A                | All consumers still import and use `Scripts` identically | Existing tests + compilation      |
| No Lua script changes   | N/A                | Zero changes to `src/commands/`                          | `git diff src/commands/` is empty |


## Scope & Constraints


### In scope

- Decomposing `scripts.ts` into focused domain modules under a new `src/classes/scripts/` directory:
- `job-scripts.ts` -- job CRUD, state transitions, data updates, progress, logging
- `queue-scripts.ts` -- queue management: pause, drain, obliterate, clean, counts, ranges, pagination
- `flow-scripts.ts` -- flow/dependency operations: child dependencies, waiting-children transitions
- `scheduler-scripts.ts` -- repeatable jobs, job schedulers, repeat key management
- `worker-scripts.ts` -- lock extension, move-to-active, stalled job recovery, move-to-finished pipeline
- Extracting shared utilities to `src/classes/scripts/script-utils.ts`:
- `pack` / msgpackr `Packr` instance
- `raw2NextJobData` helper function
- `finishedErrors` error code mapping
- `getKeepJobs` normalization helper
- Maintaining `Scripts` as a facade class that delegates to the domain modules
- Re-exporting `Scripts` from its original path so all existing imports work unchanged
- Ensuring all 30+ existing test files pass without modification

### Out of scope

- Modifying any Lua scripts in `src/commands/` (only the TypeScript layer changes)
- Changing the ScriptLoader or Lua script compilation pipeline (`npm run pretest`)
- Adding new tests (the existing test suite is the validation mechanism)
- Changing the public API surface of the `Scripts` class (method signatures, return types)
- Refactoring consumer classes (Queue, Worker, Job, etc.) to use domain modules directly
- Performance optimization of Redis operations
- Changing how `QueueBase.createScripts()` or `Job` instantiate the Scripts class

### Dependencies & Risks

- **Zero behavioral risk if done correctly**: This is a pure structural refactoring. Every method keeps its exact signature and implementation. The existing test suite (30+ files running against real Redis) is the safety net
- **Import path preservation**: Consumer classes import `Scripts` via `'./scripts'` or similar relative paths. The facade must be re-exported from the same location. The simplest approach: `src/classes/scripts.ts` becomes `src/classes/scripts/index.ts` (or `src/classes/scripts.ts` re-exports from the directory)
- **Shared state coupling**: The `Scripts` constructor initializes shared state (`moveToFinishedKeys`, Redis client, key prefix functions) that all domain modules need. Domain modules must receive this context, not duplicate it
- **Circular dependency risk**: Domain modules must not import from each other (except through shared utils). Methods that cross domain boundaries (e.g., `moveToFinished` uses `getKeepJobs`) should use the shared utils module
- **`moveToFinishedKeys` mutation**: The `moveToFinishedArgs` method mutates indices 10-13 of `moveToFinishedKeys` on each call. This state must remain in a single owner (the worker-scripts module) to avoid subtle bugs
- **Test runner**: Vitest with `--no-file-parallelism`. Redis must be running via `docker-compose up -d`. `npm run pretest` must complete before running tests (compiles Lua scripts)
- **Protected/private visibility**: Some methods are `protected` (used by subclasses or tests). Visibility must be preserved through the facade. Private `*Args` helper methods can become module-internal (not exported from facade)

## Functional Requirements


### REF-1: Create the scripts directory structure


**Required structure:**


```text
src/classes/
├── scripts/
│   ├── index.ts              # Scripts facade class + re-exports
│   ├── job-scripts.ts        # Job domain operations
│   ├── queue-scripts.ts      # Queue management operations
│   ├── flow-scripts.ts       # Flow/dependency operations
│   ├── scheduler-scripts.ts  # Scheduler and repeat operations
│   ├── worker-scripts.ts     # Worker, lock, and move-to-finished operations
│   └── script-utils.ts       # Shared utilities (pack, error mapping, helpers)
├── scripts.ts                # [OPTION A] Delete if using directory index
│                             # [OPTION B] Re-export from scripts/index.ts
└── ... (other existing classes unchanged)
```


The original import path `'./scripts'` must resolve to the facade class. Node.js module resolution allows either approach (directory with `index.ts` or a file that re-exports).


**Acceptance criteria:**

- The `src/classes/scripts/` directory contains the 7 files listed above
- The original `scripts.ts` import path resolves to the `Scripts` facade class
- No other files in `src/classes/` are renamed or moved

### REF-2: Define the shared script context


**Required behavior:**


Domain modules need access to shared resources currently held by the `Scripts` class constructor:


```typescript
interface ScriptContext {
  readonly keys: KeysMap;
  readonly toKey: (type: string) => string;
  readonly opts: QueueBaseOptions;
  readonly closing: Promise<void>;
  readonly client: RedisClient;
  readonly redisVersion: string;
  readonly databaseType: string;
  execCommand(client: RedisClient, commandName: string, args: (string | number | Buffer)[]): Promise<any>;
}
```


Each domain module receives a `ScriptContext` (or equivalent) at construction time. The `Scripts` facade creates the context once and passes it to all domain modules.


**Acceptance criteria:**

- Domain modules do not instantiate their own Redis connections or key maps
- Domain modules do not import `QueueBase` or other high-level classes (no upward dependencies)
- The shared `pack` (msgpackr Packr) instance is in `script-utils.ts` and imported by domain modules that need it
- `execCommand` is available to all domain modules via the context

### REF-3: Extract job domain operations


**Required behavior:**


Move the following methods to `job-scripts.ts`:


|           Method            | Current visibility |
| --------------------------- | ------------------ |
| `addJob`                    | public             |
| `addStandardJob`            | protected          |
| `addDelayedJob`             | protected          |
| `addPrioritizedJob`         | protected          |
| `addParentJob`              | protected          |
| `addStandardJobArgs`        | protected          |
| `addDelayedJobArgs`         | protected          |
| `addPrioritizedJobArgs`     | protected          |
| `addParentJobArgs`          | protected          |
| `remove`                    | public             |
| `removeArgs`                | private            |
| `removeUnprocessedChildren` | public             |
| `updateData`                | public             |
| `updateProgress`            | public             |
| `addLog`                    | public             |
| `isFinished`                | public             |
| `getState`                  | public             |
| `changeDelay`               | public             |
| `changeDelayArgs`           | private            |
| `changePriority`            | public             |
| `changePriorityArgs`        | protected          |
| `retryJob`                  | public             |
| `retryJobArgs`              | public             |
| `reprocessJob`              | public             |
| `promote`                   | public             |
| `removeDeduplicationKey`    | public             |


The `Scripts` facade delegates each public/protected method to the `JobScripts` module instance.


**Acceptance criteria:**

- All listed methods exist in `job-scripts.ts` with identical implementations
- The facade's corresponding methods delegate to `JobScripts`
- Private `*Args` helper methods are module-internal (not on the facade)
- `addJob`'s branching logic (standard/delayed/prioritized/parent) remains intact

### REF-4: Extract queue management operations


**Required behavior:**


Move the following methods to `queue-scripts.ts`:


|           Method           | Current visibility |
| -------------------------- | ------------------ |
| `pause`                    | public             |
| `pauseArgs`                | protected          |
| `drain`                    | public             |
| `drainArgs`                | private            |
| `obliterate`               | public             |
| `getRanges`                | public             |
| `getRangesArgs`            | private            |
| `getCounts`                | public             |
| `getCountsArgs`            | private            |
| `getCountsPerPriority`     | public             |
| `getCountsPerPriorityArgs` | private            |
| `getRateLimitTtl`          | public             |
| `getRateLimitTtlArgs`      | private            |
| `isMaxed`                  | public             |
| `isMaxedArgs`              | private            |
| `cleanJobsInSet`           | public             |
| `paginate`                 | public             |
| `moveJobFromActiveToWait`  | public             |
| `getMetrics`               | public             |


**Acceptance criteria:**

- All listed methods exist in `queue-scripts.ts` with identical implementations
- The facade's corresponding methods delegate to `QueueScripts`
- Private `*Args` helpers are module-internal

### REF-5: Extract flow/dependency operations


**Required behavior:**


Move the following methods to `flow-scripts.ts`:


|           Method            | Current visibility |
| --------------------------- | ------------------ |
| `removeChildDependency`     | public             |
| `removeChildDependencyArgs` | private            |
| `moveToWaitingChildren`     | public             |
| `moveToWaitingChildrenArgs` | public             |
| `getDependencyCounts`       | public             |
| `getDependencyCountsArgs`   | private            |


**Acceptance criteria:**

- All listed methods exist in `flow-scripts.ts` with identical implementations
- The facade delegates to `FlowScripts`

### REF-6: Extract scheduler/repeat operations


**Required behavior:**


Move the following methods to `scheduler-scripts.ts`:


|             Method             | Current visibility |
| ------------------------------ | ------------------ |
| `addRepeatableJob`             | public             |
| `addRepeatableJobArgs`         | protected          |
| `updateRepeatableJobMillis`    | public             |
| `removeRepeatable`             | public             |
| `removeRepeatableArgs`         | private            |
| `getRepeatConcatOptions`       | public             |
| `addJobScheduler`              | public             |
| `updateJobSchedulerNextMillis` | public             |
| `removeJobScheduler`           | public             |
| `getJobScheduler`              | public             |
| `getJobSchedulerArgs`          | public             |


**Acceptance criteria:**

- All listed methods exist in `scheduler-scripts.ts` with identical implementations
- The facade delegates to `SchedulerScripts`

### REF-7: Extract worker/lock operations


**Required behavior:**


Move the following methods to `worker-scripts.ts`:


|           Method            | Current visibility |
| --------------------------- | ------------------ |
| `extendLock`                | public             |
| `extendLocks`               | public             |
| `moveToActive`              | public             |
| `moveToFinished`            | public             |
| `moveToFinishedArgs`        | protected          |
| `moveToCompletedArgs`       | protected          |
| `moveToFailedArgs`          | protected          |
| `moveToDelayed`             | public             |
| `moveToDelayedArgs`         | public             |
| `moveStalledJobsToWait`     | public             |
| `moveStalledJobsToWaitArgs` | protected          |
| `retryJobs`                 | public             |
| `promoteJobs`               | public             |
| `moveJobsToWaitArgs`        | protected          |


**Key state ownership:**

- `moveToFinishedKeys` array is owned by `WorkerScripts` (it is constructed from the queue keys and mutated in `moveToFinishedArgs`)
- The `getKeepJobs` helper is used only by `moveToFinishedArgs`, so it belongs here or in `script-utils.ts`

**Acceptance criteria:**

- All listed methods exist in `worker-scripts.ts` with identical implementations
- `moveToFinishedKeys` is initialized and managed within `WorkerScripts`
- The facade delegates to `WorkerScripts`
- The `moveToFinishedArgs` mutation pattern is preserved exactly

### REF-8: Extract shared utilities


**Required behavior:**


Move the following to `script-utils.ts`:


|          Item           |         Type          |                    Used by                    |
| ----------------------- | --------------------- | --------------------------------------------- |
| `pack` (Packr instance) | Module-level constant | Job, worker, scheduler scripts                |
| `raw2NextJobData`       | Exported function     | Worker scripts (moveToFinished, moveToActive) |
| `finishedErrors`        | Exported function     | Worker scripts, job scripts (error handling)  |
| `getKeepJobs`           | Exported function     | Worker scripts (moveToFinishedArgs)           |
| `isJobInList`           | Exported function     | Queue/utility consumers                       |


**Acceptance criteria:**

- `pack` is a singleton Packr instance, imported by domain modules that encode/decode data
- `raw2NextJobData` maintains its exact signature and behavior
- `finishedErrors` maps error codes to error objects identically to the current implementation
- All shared utilities are importable from `'./script-utils'` within the scripts directory

### REF-9: Facade delegates without altering behavior


**Required behavior:**


The `Scripts` class in `scripts/index.ts` (the facade):

1. Constructor creates the `ScriptContext` and instantiates all domain module classes
2. Every public and protected method on the facade calls the corresponding domain module method with the same arguments and returns the same value
3. The facade does not add logic, validation, or transformation -- it is a pure passthrough
4. The facade class is the default export and is also a named export (`Scripts`)

Example delegation pattern:


```typescript
class Scripts {
  private jobScripts: JobScripts;
  private queueScripts: QueueScripts;
  // ...

  async addJob(client: RedisClient, job: JobJson, ...args): Promise<string> {
    return this.jobScripts.addJob(client, job, ...args);
  }

  async pause(client: RedisClient, pause: boolean): Promise<void> {
    return this.queueScripts.pause(client, pause);
  }
  // ... every public/protected method follows this pattern
}
```


**Acceptance criteria:**

- The facade class has the same constructor signature as the current `Scripts` class
- Every public and protected method that exists on the current `Scripts` class exists on the facade
- Each facade method is a one-line delegation (no added logic)
- `instanceof Scripts` still works for any code checking it (unlikely but preserved)
- The facade is exported from the same module path as the current `Scripts`

### REF-10: Consumer imports are unchanged


**Required behavior:**


The following consumer classes must continue to work with zero import changes:


|           Consumer           |                         Current import                         |
| ---------------------------- | -------------------------------------------------------------- |
| `QueueBase`                  | `import { Scripts } from './scripts'` (or similar)             |
| `Job`                        | `import { Scripts } from './scripts'` (or via `createScripts`) |
| `queue-getters.ts`           | Via inherited `scripts` property                               |
| Worker, Repeat, JobScheduler | Via inherited `scripts` property                               |


**Acceptance criteria:**

- No import statements in any file outside `src/classes/scripts/` are changed
- `createScripts()` (wherever it's defined) returns a `Scripts` instance as before
- TypeScript compilation confirms no import resolution failures

## Technical Solution


### Architecture & Components


**New files:**


|                    File                    |                          Purpose                           |
| ------------------------------------------ | ---------------------------------------------------------- |
| `src/classes/scripts/index.ts`             | Scripts facade class, re-exports                           |
| `src/classes/scripts/job-scripts.ts`       | Job domain: CRUD, state, progress, retry, promote          |
| `src/classes/scripts/queue-scripts.ts`     | Queue domain: pause, drain, obliterate, clean, counts      |
| `src/classes/scripts/flow-scripts.ts`      | Flow domain: child dependencies, waiting-children          |
| `src/classes/scripts/scheduler-scripts.ts` | Scheduler domain: repeatable jobs, job schedulers          |
| `src/classes/scripts/worker-scripts.ts`    | Worker domain: locks, active, finished, stalled            |
| `src/classes/scripts/script-utils.ts`      | Shared: pack, raw2NextJobData, finishedErrors, getKeepJobs |


**Modified files:**


|           File           |                                              Change                                               |
| ------------------------ | ------------------------------------------------------------------------------------------------- |
| `src/classes/scripts.ts` | Either deleted (if directory index replaces it) or converted to a re-export of `scripts/index.ts` |


**Unchanged files (verify via tests):**


All files in `src/classes/` except `scripts.ts`, all files in `src/commands/`, all files in `tests/`.


### Implementation notes


**Module resolution strategy:**


The safest approach is to keep `src/classes/scripts.ts` as a thin re-export file:


```typescript
export { Scripts } from './scripts/index';
export type { ScriptContext } from './scripts/script-utils';
```


This guarantees all existing relative imports (`'./scripts'`) resolve without changes. The alternative (deleting `scripts.ts` and relying on directory index resolution) also works but is slightly less explicit.


**Domain module class pattern:**


Each domain module is a class that receives `ScriptContext` in its constructor:


```typescript
export class JobScripts {
  constructor(private ctx: ScriptContext) {}

  async addJob(client: RedisClient, job: JobJson, ...): Promise<string> {
    // exact current implementation, using this.ctx.keys, this.ctx.toKey, etc.
  }
}
```


**Handling `this` references in moved methods:**


Current methods reference `this.keys`, `this.toKey()`, `this.opts`, `this.closing`, etc. After extraction, these become `this.ctx.keys`, `this.ctx.toKey()`, etc. This is a mechanical transformation -- find-and-replace within each domain module.


**`execCommand` delegation:**


Currently `Scripts.execCommand` is a public method used both internally and by some consumers. It should remain on the facade and also be available in `ScriptContext` for domain modules to call Lua scripts.


**Protected method handling:**


Some methods are `protected` (e.g., `addStandardJob`, `moveStalledJobsToWaitArgs`). These must remain accessible on the `Scripts` facade as `protected` for any subclass. If no subclasses exist in the codebase, they can be made `public` on the domain module and `protected` on the facade, but preserving the original visibility is safer.


### Dependency changes


None. No new npm packages required.


## Validation Contract


### VAL-01: All existing tests pass without modification


```gherkin
GIVEN all refactoring changes are applied
AND Redis is running via docker-compose up -d
AND npm run pretest has been executed
WHEN I run npm test
THEN all 30+ test files pass with zero failures
AND zero test files have been modified
```


### VAL-02: TypeScript compilation succeeds


```gherkin
GIVEN all refactoring changes are applied
WHEN I run npm run tsc:all
THEN compilation succeeds with zero errors
AND no new TypeScript warnings are introduced
```


### VAL-03: Lint passes


```gherkin
GIVEN all refactoring changes are applied
WHEN I run npm run lint
THEN no lint errors are reported
```


### VAL-04: No Lua script changes


```gherkin
GIVEN all refactoring changes are applied
WHEN I run git diff src/commands/
THEN the diff is empty (zero changes to Lua scripts or ScriptLoader)
```


### VAL-05: Scripts facade has all original public methods


```gherkin
GIVEN the refactored Scripts class
WHEN I compare its public method signatures to the original scripts.ts
THEN every public method that existed before exists on the facade
AND every method has the same parameter types and return type
```


### VAL-06: Domain modules exist with correct groupings


```gherkin
GIVEN the refactored codebase
WHEN I inspect src/classes/scripts/
THEN job-scripts.ts contains addJob, remove, updateData, updateProgress, addLog, isFinished, getState, changeDelay, changePriority, retryJob, reprocessJob, promote, removeDeduplicationKey, removeUnprocessedChildren
AND queue-scripts.ts contains pause, drain, obliterate, getRanges, getCounts, getCountsPerPriority, getRateLimitTtl, isMaxed, cleanJobsInSet, paginate, moveJobFromActiveToWait, getMetrics
AND flow-scripts.ts contains removeChildDependency, moveToWaitingChildren, getDependencyCounts
AND scheduler-scripts.ts contains addRepeatableJob, updateRepeatableJobMillis, removeRepeatable, getRepeatConcatOptions, addJobScheduler, updateJobSchedulerNextMillis, removeJobScheduler, getJobScheduler
AND worker-scripts.ts contains extendLock, extendLocks, moveToActive, moveToFinished, moveToDelayed, moveStalledJobsToWait, retryJobs, promoteJobs
```


### VAL-07: Shared utilities are correctly extracted


```gherkin
GIVEN the refactored codebase
WHEN I inspect src/classes/scripts/script-utils.ts
THEN it exports pack (Packr instance), raw2NextJobData, finishedErrors, getKeepJobs, and isJobInList
AND no domain module re-implements any of these utilities
```


### VAL-08: No consumer import changes


```gherkin
GIVEN the refactored codebase
WHEN I run git diff on all files outside src/classes/scripts/
THEN the only changed file is src/classes/scripts.ts (or it is deleted)
AND no import statements in queue-base.ts, queue.ts, worker.ts, job.ts, repeat.ts, job-scheduler.ts, or queue-getters.ts are modified
```


### VAL-09: Facade methods are pure delegation


```gherkin
GIVEN the Scripts facade in scripts/index.ts
WHEN I inspect each public method body
THEN each method contains exactly one statement: a call to the corresponding domain module method
AND no method adds validation, transformation, logging, or error handling beyond what the domain module does
```


### VAL-10: Original scripts.ts import path resolves correctly


```gherkin
GIVEN the refactored codebase
WHEN any file imports from './scripts' or '../scripts' (the original relative path)
THEN the import resolves to the Scripts facade class
AND the import compiles without errors
```


---

# Technical Context
# Technical Context: Scripts Class Domain Module Refactoring

## Verified Tech Stack

From `package.json` (`dependencies` and `devDependencies` sections):

- **Language**: TypeScript 5.9.3 (`typescript: "5.9.3"` in devDependencies)
- **Runtime target**: ES2017 (from `tsconfig.json` `compilerOptions.target`)
- **Module format**: ES2020 (`tsconfig.json` `compilerOptions.module`), CJS via `tsconfig-cjs.json`
- **Package manager**: Yarn 1.22.22 (`packageManager` field)
- **Test framework**: Vitest 4.0.18 (`vitest: "4.0.18"` in devDependencies)
- **Redis client**: ioredis 5.9.3 (`ioredis: "5.9.3"` in dependencies)
- **Serialization**: msgpackr 1.11.5 (`msgpackr: "1.11.5"` in dependencies)
- **Output paths**: `dist/esm` (ESM build) and `dist/cjs` (CJS build)

TypeScript strict mode is enabled with `strictNullChecks: false` (from `tsconfig.json` `compilerOptions`).

---

## Relevant Files & Patterns

### File to decompose

- `src/classes/scripts.ts` — 1,844 lines, ~80+ methods. The single monolithic `Scripts` class. This is the primary file being refactored. Module-level state includes the `packer`/`pack` Packr instance and the `raw2NextJobData` export.

### Existing consumers (must not be touched)

- `src/classes/queue-base.ts` — imports `Scripts` from `'./scripts'` (line 20) and `createScripts` from `'../utils/create-scripts'` (line 16); holds `protected scripts: Scripts` property (line 36); calls `this.createScripts()` in constructor.
- `src/classes/job.ts` — imports `Scripts` from `'./scripts'` (line 40) and `createScripts` from `'../utils/create-scripts'` (line 38).
- `src/classes/index.ts` — barrel export at line 22: `export * from './scripts'`. This re-exports everything from `scripts.ts`, including the `JobData` type. The new `scripts.ts` stub or `scripts/index.ts` must preserve all exports.
- `src/utils/create-scripts.ts` — factory function that constructs a `ScriptContext`-compatible object from `MinimalQueue` and passes it to `new Scripts(...)`.

### Existing interface — reuse as ScriptContext base

- `src/interfaces/script-queue-context.ts` — defines `ScriptQueueContext` with `opts`, `toKey`, `keys`, `closing`, `client` (Promise getter), `databaseType` (getter), `redisVersion` (getter). The PRD's `ScriptContext` adds `execCommand` on top of this. Define `ScriptContext` in `script-utils.ts` by extending `ScriptQueueContext` and adding the `execCommand` signature.
- `src/interfaces/minimal-queue.ts` — `MinimalQueue extends ScriptQueueContext`. No changes needed.

### Existing patterns to follow

- **Module-level constants before the class**: `scripts.ts` declares `packer` and `pack` at the top, outside the class. The same pattern should apply in `script-utils.ts` — define the `Packr` instance and the `pack` binding at module level.
- **ChainableCommander typing in execCommand**: `execCommand` currently accepts `RedisClient | ChainableCommander` (from ioredis). The `ScriptContext.execCommand` signature must match this to allow pipelined calls (see `worker-scripts` methods that use `ChainableCommander`).
- **`*Args` methods return arrays, async methods call execCommand**: The pattern throughout `scripts.ts` is that private/protected `*Args()` methods build the argument arrays synchronously, and the corresponding public `async` method awaits `this.queue.client`, then calls `this.execCommand(client, 'commandName', args)`.
- **Error throwing via `finishedErrors`**: Every domain file currently calls `this.finishedErrors({code, jobId, ...})`. After extraction, this becomes a call to the imported utility function `finishedErrors({code, jobId, ...})` from `./script-utils`.

### New files location

All new files must be created under `src/classes/scripts/`:

```
src/classes/scripts/
├── index.ts           ← Scripts facade class
├── job-scripts.ts
├── queue-scripts.ts
├── flow-scripts.ts
├── scheduler-scripts.ts
├── worker-scripts.ts
└── script-utils.ts
```

---

## Integration Points

### Module resolution — the critical path

`src/classes/scripts.ts` is imported by:
1. `src/classes/queue-base.ts` via `'./scripts'`
2. `src/classes/job.ts` via `'./scripts'`
3. `src/classes/index.ts` via `'./scripts'`
4. `src/utils/create-scripts.ts` via `'../classes/scripts'`

Node.js module resolution: when `'./scripts'` is requested, Node checks for `scripts.ts` before `scripts/index.ts`. **Therefore, the safest approach is to keep `src/classes/scripts.ts` as a thin re-export stub** rather than deleting it:

```typescript
// src/classes/scripts.ts (stub — replaces original file)
export { Scripts } from './scripts/index';
export type { ScriptContext } from './scripts/script-utils';
export type { JobData } from './scripts/index';
export { raw2NextJobData } from './scripts/script-utils';
```

This preserves all existing import paths with zero risk.

### `JobData` type re-export

`JobData` (`export type JobData = [JobJsonRaw | number, string?]`) is currently defined at line 49 of `scripts.ts` and re-exported through `src/classes/index.ts`. It must remain accessible at the same path. Define it in `scripts/index.ts` or `scripts/script-utils.ts` and re-export it through the `scripts.ts` stub.

### `raw2NextJobData` re-export

`raw2NextJobData` is a module-level exported function at the bottom of `scripts.ts` (line 1835). It is consumed by worker methods internally and must be re-exported from `script-utils.ts` and surfaced through the `scripts.ts` stub.

### `src/classes/index.ts` barrel export

The existing `export * from './scripts'` at line 22 of `src/classes/index.ts` must continue to resolve. The stub approach satisfies this automatically.

**Impact boundary:** All changes are confined to `src/classes/scripts.ts` (converted to stub) and the new `src/classes/scripts/` directory. No other file in the repository changes.

---

## Data Persistence

### Shared mutable state: `moveToFinishedKeys`

`moveToFinishedKeys: (string | undefined)[]` is initialized in the `Scripts` constructor (lines 59–74 of `scripts.ts`) and mutated in `moveToFinishedArgs` (lines 726–730). This pre-allocated array avoids per-call allocations.

**Ownership rule**: This array must be initialized and owned by `WorkerScripts`, not the facade. Pattern:

```typescript
export class WorkerScripts {
  private moveToFinishedKeys: (string | undefined)[];

  constructor(private ctx: ScriptContext) {
    const queueKeys = ctx.keys;
    this.moveToFinishedKeys = [
      queueKeys.wait,
      queueKeys.active,
      // ... 14 entries total (indices 0-13); indices 10-13 are mutated per call
    ];
  }
}
```

### ScriptContext interface (to define in `script-utils.ts`)

The existing `ScriptQueueContext` lacks `execCommand`. The new `ScriptContext` must add it:

```typescript
// src/classes/scripts/script-utils.ts
import { ScriptQueueContext } from '../../interfaces';
import { RedisClient } from '../../interfaces';
import { ChainableCommander } from 'ioredis';

export interface ScriptContext extends ScriptQueueContext {
  execCommand(
    client: RedisClient | ChainableCommander,
    commandName: string,
    args: any[],
  ): any;
}
```

The facade constructs this context object in its constructor by binding its own `execCommand` method:

```typescript
// src/classes/scripts/index.ts
export class Scripts {
  private readonly ctx: ScriptContext;
  private jobScripts: JobScripts;
  // ...

  constructor(queue: ScriptQueueContext) {
    this.ctx = {
      ...queue,  // spread won't work for getters; use Object.create or explicit property mapping
      execCommand: this.execCommand.bind(this),
    };
    this.jobScripts = new JobScripts(this.ctx);
    // ...
  }
}
```

⚠️ **Architecture Note**: `ScriptQueueContext` uses getter properties (`get client()`, `get databaseType()`, `get redisVersion()`), so the context object cannot be created via simple object spread. The facade must construct `ScriptContext` preserving getter semantics — either via `Object.create` with property descriptors, or by passing the `queue` object directly alongside `execCommand`. The simplest correct approach: make domain modules accept `(queue: ScriptQueueContext, execCommand: ...)` in constructor, or define `ScriptContext` to hold a reference to `queue` and the bound `execCommand`:

```typescript
export class Scripts {
  private ctx: ScriptContext;

  constructor(protected queue: ScriptQueueContext) {
    const self = this;
    this.ctx = {
      get keys() { return queue.keys; },
      get opts() { return queue.opts; },
      get toKey() { return queue.toKey; },
      get closing() { return queue.closing; },
      get client() { return queue.client; },
      get redisVersion() { return queue.redisVersion; },
      get databaseType() { return queue.databaseType; },
      execCommand: self.execCommand.bind(self),
    };
    // instantiate domain modules...
  }
}
```

---

## Technical Constraints

### TypeScript visibility preservation

Methods marked `protected` on `Scripts` must remain `protected` on the facade. Domain module classes may expose them as `public` internally (TypeScript allows this — the facade is what consumers see). Example:

```typescript
// WorkerScripts domain module (public visibility internally is fine)
export class WorkerScripts {
  moveToFinishedArgs<T, R, N extends string>(...): (...) { ... }
}

// Scripts facade (preserves protected)
export class Scripts {
  protected moveToFinishedArgs<T, R, N extends string>(...) {
    return this.workerScripts.moveToFinishedArgs(...);
  }
}
```

### `finishedErrors` as standalone function

Currently `finishedErrors` is an instance method (line 1759) but accesses **no** `this` properties — it is a pure function of its parameters. It must become an exported function in `script-utils.ts`:

```typescript
export function finishedErrors({
  code, jobId, parentKey, command, state,
}: { code: number; jobId?: string; parentKey?: string; command: string; state?: string; }): Error {
  // exact switch statement from current implementation
}
```

Domain modules call `finishedErrors(...)` (imported) instead of `this.finishedErrors(...)`.

### `getKeepJobs` as standalone function

Currently a `protected` instance method (line 763) with no `this` access. Must become an exported function in `script-utils.ts`. The facade's `protected getKeepJobs(...)` method is NOT required since no external consumer calls it directly (only `moveToFinishedArgs` uses it, and that moves to `WorkerScripts`).

### `isJobInList` placement

`isJobInList` (line 86) uses `this.queue.client`, `this.execCommand`, `this.queue.redisVersion`, and `this.queue.databaseType`. The PRD places it in `script-utils.ts` as an exported function taking a `ScriptContext` parameter:

```typescript
export async function isJobInList(
  ctx: ScriptContext,
  listKey: string,
  jobId: string,
): Promise<boolean> { ... }
```

The facade's public `isJobInList` delegates: `return isJobInList(this.ctx, listKey, jobId)`.

### Circular dependency prevention

- Domain modules import only from `'./script-utils'` and external packages
- Domain modules must NOT import from each other
- `script-utils.ts` must NOT import from any domain module
- Run `npm run pretest` (which includes `madge --circular`) to verify after implementation

### `pack` binding

The current code uses `const pack = packer.pack` (line 13 of `scripts.ts`). `Packr.pack` is a method that internally references `this` (the packer instance). The binding `packer.pack` pre-binds `this`. When moving to `script-utils.ts`, preserve the same pattern:

```typescript
// script-utils.ts
const packer = new Packr({ useRecords: false, encodeUndefinedAsNil: true });
export const pack = packer.pack;
```

If `pack` is exported as an arrow or unbound method, msgpackr will lose its instance context and serialization will break.

---

## Testing Strategy

The existing test suite (30+ files in `tests/`) is the validation mechanism. No new test files are to be created. The test scenarios below describe what the existing suite already validates and what the code generator must verify compiles and passes.

**Existing test infrastructure pattern** (from `tests/scripts.test.ts` and other test files):
- Vitest with explicit imports (`describe`, `it`, `expect`, `beforeEach`, `afterEach`, `beforeAll`, `afterAll`)
- `beforeAll`: creates `IORedis` connection
- `beforeEach`: creates UUID-named queue, calls `queue.waitUntilReady()`
- `afterEach`: closes queue, removes queue data
- `afterAll`: quits connection
- Sequential execution (`--no-file-parallelism` in `vitest.config.ts`)

**Validation execution sequence:**

```bash
# 1. Compile Lua scripts (required before tests)
npm run pretest

# 2. TypeScript compilation check
npm run tsc:all

# 3. Lint check
npm run lint

# 4. Full test run (Redis must be running)
npm test
```

**Test scenarios the code generator must ensure pass (structural verification):**

1. **Import resolution**: `import { Scripts } from '../src/classes/scripts'` (used by `queue-base.ts`, `job.ts`) resolves to the facade class — verified by TypeScript compilation succeeding with `npm run tsc:all`.

2. **Barrel export chain**: `import { Scripts } from '../src/classes'` (via `src/classes/index.ts` → `src/classes/scripts.ts` stub → `src/classes/scripts/index.ts`) resolves correctly — verified by `npm run tsc:all`.

3. **`JobData` type availability**: Any consumer that imports `JobData` from `'./scripts'` or `'../classes/scripts'` must still resolve — verify `JobData` is re-exported through the stub.

4. **`raw2NextJobData` accessibility**: The function was exported from `scripts.ts`; it must remain exportable (even if moved to `script-utils.ts` and re-exported).

5. **Facade constructor signature unchanged**: `new Scripts(queue: ScriptQueueContext)` — `create-scripts.ts` calls this with a constructed context object; the constructor signature must not change.

6. **`moveToFinishedKeys` mutation correctness**: `tests/worker.test.ts` exercises `moveToFinished` → `moveToCompletedArgs` / `moveToFailedArgs` chains. The pre-allocated key array mutation at indices 10–13 must work identically. Any regression causes worker test failures.

7. **`protected` method access from subclasses**: Any class in `src/classes/` that extends `Scripts` or `QueueBase` (which holds `protected scripts: Scripts`) and calls protected methods like `moveToFinishedArgs`, `moveToCompletedArgs`, or `moveToFailedArgs` must compile without errors.

8. **No Lua script changes**: After applying all changes, `git diff src/commands/` must be empty. The Lua scripts and `ScriptLoader` are untouched.
