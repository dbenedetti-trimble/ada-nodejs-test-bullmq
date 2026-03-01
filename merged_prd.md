# Product Requirements Document (PRD)
**Repository**: `https://github.com/dbenedetti-trimble/ada-nodejs-test-bullmq`

---


# Structured Job Lifecycle Logging


## Context & Problem


### Problem statement

- **Who is affected?** Developers operating BullMQ queues and workers in production, who need visibility into job processing behavior without resorting to Redis inspection or custom event listeners.
- **What is the issue?** BullMQ has telemetry (OTel-style spans/metrics) and Redis stream events, but no simple structured logging interface. Developers who want log lines at key lifecycle points must wire up `QueueEvents` listeners manually, format their own log entries, and compute durations themselves. This is boilerplate that every serious deployment ends up writing.
- **Why does it matter?** A first-class logger interface with structured output at lifecycle points gives operators immediate visibility. It's low-risk (no core behavior changes), high-value (every deployment benefits), and tests whether Ada can thread a cross-cutting concern through multiple classes without breaking existing functionality.

### Success metrics


|            Metric            |          Baseline          |                       Target                       |   Validation method    |
| ---------------------------- | -------------------------- | -------------------------------------------------- | ---------------------- |
| Logger interface defined     | No logger interface exists | `LifecycleLogger` interface in `src/interfaces/`   | TypeScript compilation |
| Queue accepts logger option  | No logger option           | `logger` option on `QueueOptions`                  | Unit tests             |
| Worker accepts logger option | No logger option           | `logger` option on `WorkerOptions`                 | Unit tests             |
| Lifecycle events logged      | 0 lifecycle points         | 8+ lifecycle points produce structured log entries | Integration tests      |
| Default behavior unchanged   | N/A                        | No logging when logger not provided (no-op)        | Existing tests pass    |
| All existing tests pass      | 100% pass                  | 100% pass (no regressions)                         | `npm test` with Redis  |
| TypeScript compiles          | Compiles                   | Compiles with no new errors                        | `npm run tsc:all`      |
| Lint clean                   | Clean                      | Clean                                              | `npm run lint`         |


## Scope & Constraints


### In scope

- New `LifecycleLogger` interface with level-based methods (`debug`, `warn`, `error`)
- New `LifecycleLogEntry` type defining the structured log shape
- `logger` option added to `QueueBaseOptions` (inherited by both Queue and Worker)
- Structured log calls at key lifecycle points in Queue and Worker
- Event filter option to opt in/out of specific lifecycle events
- Unit and integration tests for the logging behavior
- TypeScript interface exports from the package index

### Out of scope

- Providing a default logger implementation (e.g., console logger). The default is no-op
- Modifying the existing telemetry interface or OTel integration
- Modifying Lua scripts (this is a TypeScript-only change)
- Changing QueueEvents behavior or Redis stream events
- Adding logging to FlowProducer or JobScheduler (future enhancement)
- Log persistence or log shipping

### Dependencies & Risks

- **No new npm dependencies**: The logger interface is injected by the user; BullMQ provides only the interface contract
- **Backwards compatibility**: The `logger` option is optional with no-op default. Existing code that does not pass a logger sees zero behavior change
- **Performance**: Log calls are guarded by a null check on the logger. When no logger is configured, the overhead is a single falsy check per lifecycle point. When a logger is configured, the cost of constructing the log entry object is the user's opt-in tradeoff
- **Test runner**: Tests must use Vitest, matching the existing test infrastructure. Redis must be running via `docker-compose up -d`

## Functional Requirements


### LOG-1: Define the lifecycle logger interface


**Required interface:**


```typescript
interface LifecycleLogEntry {
  timestamp: number;
  event: LifecycleEvent;
  queue: string;
  jobId?: string;
  jobName?: string;
  attemptsMade?: number;
  duration?: number;
  data?: Record<string, unknown>;
}

type LifecycleEvent =
  | 'job:added'
  | 'job:active'
  | 'job:completed'
  | 'job:failed'
  | 'job:retrying'
  | 'job:delayed'
  | 'job:stalled'
  | 'job:rate-limited';

interface LifecycleLogger {
  debug(entry: LifecycleLogEntry): void;
  warn(entry: LifecycleLogEntry): void;
  error(entry: LifecycleLogEntry): void;
}
```


**Acceptance criteria:**

- `LifecycleLogger`, `LifecycleLogEntry`, and `LifecycleEvent` are exported from `src/interfaces/`
- The interface is re-exported from the package's main `src/interfaces/index.ts`
- The types are available for import by consumers: `import { LifecycleLogger } from 'bullmq'`

### LOG-2: Add logger option to Queue and Worker


**Required behavior:**


Add a `logger` option to `QueueBaseOptions`:


```typescript
interface QueueBaseOptions {
  // ... existing options ...
  logger?: LifecycleLogger;
  logEvents?: LifecycleEvent[];
}
```

- `logger`: User-provided logger implementation. If not provided, no lifecycle logging occurs
- `logEvents`: Optional array of events to log. If not provided but `logger` is, all events are logged. If provided, only the listed events produce log calls

**Acceptance criteria:**

- `QueueBaseOptions` accepts `logger` and `logEvents` options
- Both Queue and Worker inherit the option via `QueueBaseOptions`
- Passing no `logger` results in zero logging overhead beyond a falsy check
- Passing a `logger` without `logEvents` logs all lifecycle events
- Passing a `logger` with `logEvents: ['job:completed', 'job:failed']` logs only those two events

### LOG-3: Log at lifecycle points with appropriate levels


**Required logging points:**


|  Lifecycle event   |                   Location                   | Log level |                          Key metadata                          |
| ------------------ | -------------------------------------------- | --------- | -------------------------------------------------------------- |
| `job:added`        | `Queue.addJob()` after job creation          | `debug`   | jobId, jobName, delay (if any)                                 |
| `job:active`       | `Worker.processJob()` when processing starts | `debug`   | jobId, jobName, attemptsMade                                   |
| `job:completed`    | `Worker.handleCompleted()`                   | `debug`   | jobId, jobName, duration, attemptsMade                         |
| `job:failed`       | `Worker.handleFailed()`                      | `error`   | jobId, jobName, failedReason, attemptsMade, stacktrace in data |
| `job:retrying`     | `Job.moveToFailed()` when retry is scheduled | `warn`    | jobId, jobName, attemptsMade, delay, maxAttempts in data       |
| `job:delayed`      | `Job.moveToDelayed()` or retry with delay    | `debug`   | jobId, jobName, delay                                          |
| `job:stalled`      | `Worker.moveStalledJobsToWait()`             | `warn`    | jobId                                                          |
| `job:rate-limited` | Worker rate limit path                       | `debug`   | jobId, jobName                                                 |


**Acceptance criteria:**

- Each lifecycle point produces a `LifecycleLogEntry` with all applicable fields populated
- `timestamp` is `Date.now()` at the point of the log call
- `queue` is the queue name string
- `duration` is populated for `job:completed` and `job:failed` (milliseconds since processing started)
- Failed jobs include `failedReason` in the `data` field
- Retrying jobs include `delay` and the max attempts configured
- The log level mapping follows the table above (routine events are debug, retries/stalls are warn, failures are error)
- When `logEvents` is configured, events not in the list are skipped without constructing the log entry object

### LOG-4: Log entry construction is lazy when filtered


**Required behavior:**


When `logEvents` is configured and an event is not in the filter list, the log entry object must not be constructed. The check should be:


```typescript
if (this.logger && this.shouldLog('job:completed')) {
  this.logger.debug({ timestamp: Date.now(), ... });
}
```


Not:


```typescript
const entry = { timestamp: Date.now(), ... };
if (this.logger && this.shouldLog('job:completed')) {
  this.logger.debug(entry);
}
```


**Acceptance criteria:**

- Event filtering avoids constructing unused objects
- A helper method (e.g., `shouldLog(event)`) centralizes the filter check

## Technical Solution


### Architecture & Components


**New files:**


|                 File                 |                              Purpose                               |
| ------------------------------------ | ------------------------------------------------------------------ |
| `src/interfaces/lifecycle-logger.ts` | `LifecycleLogger`, `LifecycleLogEntry`, and `LifecycleEvent` types |


**Modified files:**


|               File                |                                              Change                                               |
| --------------------------------- | ------------------------------------------------------------------------------------------------- |
| `src/interfaces/index.ts`         | Export new lifecycle logger types                                                                 |
| `src/interfaces/queue-options.ts` | Add `logger` and `logEvents` to `QueueBaseOptions`                                                |
| `src/classes/queue-base.ts`       | Store logger reference and implement `shouldLog` helper                                           |
| `src/classes/queue.ts`            | Add log call in `addJob()`                                                                        |
| `src/classes/worker.ts`           | Add log calls in `processJob()`, `handleCompleted()`, `handleFailed()`, `moveStalledJobsToWait()` |
| `src/classes/job.ts`              | Add log calls in `moveToFailed()` retry path and `moveToDelayed()`                                |
| `tests/test_lifecycle_logging.ts` | New test file for all logging behavior                                                            |


### Implementation notes


**Logger propagation:**

- `QueueBase` (parent of both Queue and Worker) stores the logger and logEvents from options
- `QueueBase` provides a protected `shouldLog(event: LifecycleEvent): boolean` method
- Queue and Worker use `this.shouldLog(event)` before constructing log entries
- Job methods that need to log receive the logger via their existing queue/scripts reference (Job already has access to the queue name via `this.queueName`)

**Duration tracking for completed/failed:**

- Worker already tracks processing start time internally for its own metrics. Use the same timing mechanism to compute duration for the log entry
- If the start time is not directly accessible in the handler, capture `Date.now()` at the start of `processJob()` and pass it through to the completion/failure handlers

**No-op fast path:**

- When no logger is configured, `this.logger` is `undefined`. The `shouldLog` method returns `false` immediately when `this.logger` is falsy. This means the only overhead per lifecycle point is a single property access and falsy check

### Dependency changes


None. No new npm packages required.


## Validation Contract


### VAL-01: Logger receives structured entries on job completion


```gherkin
GIVEN a Queue with a logger configured
AND a Worker processing jobs from that queue
WHEN a job is added, processed, and completes successfully
THEN the logger.debug is called with a 'job:added' entry containing jobId and queue name
AND the logger.debug is called with a 'job:active' entry containing jobId and attemptsMade
AND the logger.debug is called with a 'job:completed' entry containing jobId, duration > 0, and attemptsMade
```


### VAL-02: Failed jobs log at error level with failure details


```gherkin
GIVEN a Worker with a logger configured
AND a processor that throws an error
WHEN a job is processed and fails (no retries configured)
THEN the logger.error is called with a 'job:failed' entry
AND the entry contains jobId, jobName, and failedReason in data
AND the entry contains attemptsMade
```


### VAL-03: Retrying jobs log at warn level


```gherkin
GIVEN a Worker with a logger configured
AND a job configured with attempts: 3
AND a processor that throws on the first attempt
WHEN the job fails and is scheduled for retry
THEN the logger.warn is called with a 'job:retrying' entry
AND the entry contains attemptsMade, delay, and maxAttempts in data
```


### VAL-04: Stalled jobs log at warn level


```gherkin
GIVEN a Worker with a logger configured
AND a job that becomes stalled (lock expires during processing)
WHEN the stalled job checker runs
THEN the logger.warn is called with a 'job:stalled' entry containing the jobId
```


### VAL-05: No logging when logger is not configured


```gherkin
GIVEN a Queue and Worker with no logger option
WHEN jobs are added, processed, completed, and failed
THEN no errors occur
AND no logging functions are called
AND all behavior is identical to the current codebase
```


### VAL-06: Event filtering respects logEvents option


```gherkin
GIVEN a Worker with logger configured and logEvents: ['job:completed', 'job:failed']
WHEN a job is added, processed, and completes
THEN the logger.debug is called with a 'job:completed' entry
AND the logger is NOT called for 'job:added' or 'job:active' events
```


### VAL-07: All lifecycle events fire correctly in a full cycle


```gherkin
GIVEN a Queue and Worker with a logger that records all calls
WHEN a job is added with attempts: 2
AND the processor fails on the first attempt
AND the processor succeeds on the second attempt
THEN the logged events in order are: job:added, job:active, job:failed (or job:retrying), job:active, job:completed
AND each entry has a valid timestamp, queue name, and jobId
```


### VAL-08: Logger interface is correctly exported


```gherkin
GIVEN the BullMQ package
WHEN I import { LifecycleLogger, LifecycleLogEntry, LifecycleEvent } from 'bullmq'
THEN the types are available and usable in TypeScript
```


### VAL-09: No regressions in existing test suite


```gherkin
GIVEN all changes are applied
WHEN I run npm test with Redis running
THEN all existing tests pass
AND when I run npm run tsc:all
THEN TypeScript compilation succeeds
AND when I run npm run lint
THEN no lint errors are reported
```


### VAL-10: Duration is accurately measured


```gherkin
GIVEN a Worker with a logger configured
AND a processor that takes approximately 100ms (via setTimeout)
WHEN the job completes
THEN the 'job:completed' log entry has a duration value between 80 and 200 (allowing for timing variance)
```


---

# Technical Context
# Technical Context: Structured Job Lifecycle Logging

---

## Verified Tech Stack

From `package.json` (`dependencies` and `devDependencies` sections):

- **Language**: TypeScript 5.9.3 (`typescript: 5.9.3` in devDependencies)
- **Runtime target**: Node.js 18.x (`@types/node: 18.19.130`)
- **Package Manager**: Yarn 1.22.22 (`packageManager` field)
- **Test Framework**: Vitest 4.0.18 (`vitest: 4.0.18` in devDependencies)
- **Test Coverage**: `@vitest/coverage-v8: 4.0.18`
- **Redis client**: ioredis 5.9.3 (`ioredis: 5.9.3` in dependencies)
- **Linter**: ESLint 9.39.2 with `@typescript-eslint/eslint-plugin: 8.54.0`
- **Formatter**: Prettier 3.8.1
- **Build**: TypeScript compiler via `tsc` (ESM → `dist/esm/`, CJS → `dist/cjs/`)

---

## Relevant Files & Patterns

### Files directly involved in this change

- `src/interfaces/queue-options.ts` — Defines `QueueBaseOptions` (the `telemetry?: Telemetry` field at line 40 is the exact pattern to follow for `logger?: LifecycleLogger`)
- `src/interfaces/telemetry.ts` — The existing injected-interface pattern: a user-supplied object implementing a typed interface, stored optionally on options, accessed via `this.opts.telemetry`. `LifecycleLogger` should mirror this pattern.
- `src/interfaces/index.ts` — Re-exports all interfaces via `export * from './<filename>'`. The new `lifecycle-logger.ts` export line must be added here.
- `src/classes/queue-base.ts` — Parent class for both `Queue` and `Worker`. The `trace()` method (lines 205–221) is the direct analogue for the new `shouldLog()` protected method — both are protected helpers that gate a cross-cutting concern. `QueueBase` stores `this.opts` including `telemetry`; `logger` and `logEvents` are stored the same way.
- `src/classes/queue.ts` — `addJob()` method (lines 353–391) is `protected async`; the log call for `job:added` goes after `this.Job.create()` at line 377, before the return.
- `src/classes/worker.ts` — Three target methods:
  - `processJob()` (line 944): `processedOn = Date.now()` is already captured at line 965 — this value is the start time for duration computation. The `job:active` log goes after `this.emit('active', job, 'waiting')` at line 963.
  - `handleCompleted()` (line 1068): `job:completed` log goes after `this.emit('completed', ...)` at line 1081. `processedOn` must be threaded through from `processJob()`.
  - `handleFailed()` (line 1100): `job:rate-limited` log inside the `RATE_LIMIT_ERROR` branch (lines 1109–1112); `job:failed` log after `this.emit('failed', ...)` at line 1133.
  - `moveStalledJobsToWait()` (line 1397): `job:stalled` log inside the `stalled.forEach()` loop at line 1411, alongside the existing `this.emit('stalled', jobId, 'active')`.
- `src/classes/job.ts` — Two target locations:
  - `moveToFailed()` (line 804): `job:retrying` log in the `shouldRetry` branch (lines 836–859). Accessible via `this.queue.opts` which is typed as `QueueBaseOptions` (line 49 of `queue-base.ts` shows `public opts: QueueBaseOptions`). Access logger as `(this.queue.opts as QueueBaseOptions).logger`.
  - `moveToDelayed()` (line 1413): `job:delayed` log after `this.scripts.moveToDelayed()`.
- `tests/telemetry_interface.test.ts` — Reference test file for the identical pattern: injected interface mock via inline class, Vitest imports, `sinon` for spies. The structure of `MockTelemetry` / `MockTracer` / `MockSpan` is the direct template for `MockLifecycleLogger`.

### New file to create

- `src/interfaces/lifecycle-logger.ts` — New file. Pattern: mirrors `src/interfaces/telemetry.ts` structurally (exported types only, no classes, no imports needed).

### Existing patterns to follow

- **Injected-interface option pattern**: `telemetry?: Telemetry` in `QueueBaseOptions` (`src/interfaces/queue-options.ts`, `QueueBaseOptions` interface). The logger fields follow this exact shape: optional, user-supplied, no default implementation.
- **Protected cross-cutting helper in QueueBase**: The `trace()` method in `src/classes/queue-base.ts` (lines 205–221) demonstrates how to add a protected utility method that gates behaviour on an optional option (`this.opts.telemetry`). The `shouldLog()` method replicates this pattern gating on `this.opts.logger` and `this.opts.logEvents`.
- **Telemetry usage pattern in worker**: `span?.setAttributes(...)` and `span?.addEvent(...)` are guarded with optional chaining — the logger guard should use `if (this.shouldLog('event:name'))` block syntax (not optional chaining) because the log entry object must not be constructed when filtered (per LOG-4).
- **Job accessing queue options**: `src/classes/job.ts` accesses `this.queue.opts?.telemetry?.meter` at line 921 (`recordJobMetrics` method). The logger is accessed the same way: `(this.queue.opts as QueueBaseOptions).logger`.
- **Interface re-export**: `src/interfaces/index.ts` uses `export * from './filename'` (no `.ts` extension) — the new lifecycle-logger export must follow this exact format.
- **Test structure**: All tests in `tests/` use explicit Vitest imports (`import { describe, beforeEach, afterEach, ... } from 'vitest'`), UUID-based queue names (`queueName = \`test-${v4()}\``), shared `IORedis` connection in `beforeAll`, and `removeAllQueueData` cleanup in `afterEach`.

---

## Integration Points

### Systems/modules affected

- **`QueueBaseOptions` interface** (`src/interfaces/queue-options.ts`): Receives two new optional fields. Both `QueueOptions` and `WorkerOptions` extend `QueueBaseOptions` and inherit the fields automatically — no changes needed to `src/interfaces/worker-options.ts` or the `QueueOptions` interface itself.
- **`MinimalQueue` interface** (`src/interfaces/minimal-queue.ts`): `Job` methods access the queue via this interface (`this.queue: MinimalQueue`). The interface does **not** currently expose `opts`. Job accesses `this.queue.opts` by casting — `(this.queue.opts as QueueBaseOptions).logger`. No change to `MinimalQueue` is required, but the cast must import `QueueBaseOptions`.
- **`src/classes/queue-base.ts`**: Stores `shouldLog()` protected method. No constructor signature change — `opts` already passes through `QueueBaseOptions` which will include the new fields.
- **`src/index.ts` / package public API**: The new types (`LifecycleLogger`, `LifecycleLogEntry`, `LifecycleEvent`) become part of the public package API once exported from `src/interfaces/index.ts` (which is already re-exported from `src/index.ts`).
- **`handleCompleted` / `handleFailed` signatures**: `processedOn` (already a local variable in `processJob()` at line 965) must be passed down to both handlers to compute `duration`. The method signatures for `handleCompleted` and `handleFailed` receive a new `processedOn?: number` parameter, or `processedOn` is captured as a closure variable within the `processJob` scope before calling the handlers.

**Impact boundary**: This is a TypeScript-only, additive change. No Lua scripts are touched. No Redis data structures change. No new npm dependencies. Existing `QueueEvents` / `FlowProducer` / `JobScheduler` are untouched. The change is a pure cross-cutting opt-in: zero impact on any consumer that does not pass `logger`.

---

## Data Persistence

The `LifecycleLogEntry` payload shape defines the structured object passed to logger methods at runtime. No database schema changes occur. The type definition for reference:

```typescript
// src/interfaces/lifecycle-logger.ts (new file)

export type LifecycleEvent =
  | 'job:added'
  | 'job:active'
  | 'job:completed'
  | 'job:failed'
  | 'job:retrying'
  | 'job:delayed'
  | 'job:stalled'
  | 'job:rate-limited';

export interface LifecycleLogEntry {
  timestamp: number;        // Date.now() at point of log call
  event: LifecycleEvent;
  queue: string;            // this.name (from QueueBase)
  jobId?: string;
  jobName?: string;
  attemptsMade?: number;    // job.attemptsMade
  duration?: number;        // milliseconds: Date.now() - processedOn
  data?: Record<string, unknown>;  // event-specific: failedReason, delay, etc.
}

export interface LifecycleLogger {
  debug(entry: LifecycleLogEntry): void;
  warn(entry: LifecycleLogEntry): void;
  error(entry: LifecycleLogEntry): void;
}
```

### Field population per event

| Event | `jobId` | `jobName` | `attemptsMade` | `duration` | `data` contents |
|---|---|---|---|---|---|
| `job:added` | `job.id` | `job.name` | — | — | `{ delay: job.opts.delay }` if delay set |
| `job:active` | `job.id` | `job.name` | `job.attemptsMade` | — | — |
| `job:completed` | `job.id` | `job.name` | `job.attemptsMade` | `Date.now() - processedOn` | — |
| `job:failed` | `job.id` | `job.name` | `job.attemptsMade` | `Date.now() - processedOn` | `{ failedReason: err.message, stacktrace }` |
| `job:retrying` | `job.id` | `job.name` | `job.attemptsMade` | — | `{ delay: retryDelay, maxAttempts: job.opts.attempts }` |
| `job:delayed` | `job.id` | `job.name` | — | — | `{ delay: finalDelay }` |
| `job:stalled` | `jobId` (string) | — | — | — | — |
| `job:rate-limited` | `job.id` | `job.name` | — | — | — |

---

## Technical Constraints

- **No new npm dependencies**: The logger interface is a pure TypeScript contract. No runtime library is added.
- **Lazy entry construction (LOG-4)**: The `shouldLog()` helper must be called **before** constructing the `LifecycleLogEntry` object literal. The inline construction pattern `this.logger.debug({ timestamp: Date.now(), ... })` inside the `if` guard is required — not pre-assigned to a variable.
- **`shouldLog()` implementation**: Must return `false` immediately when `this.opts.logger` is falsy (zero overhead path). When `logger` is set and `logEvents` is undefined, returns `true` for all events. When `logEvents` is set, uses `Array.prototype.includes()`.
- **TypeScript compilation**: `yarn tsc:all` compiles both ESM (`tsconfig.json`) and CJS (`tsconfig-cjs.json`). Both must pass.
- **Lint**: ESLint 9.39.2 with `@typescript-eslint/eslint-plugin`. TSDoc comments are linted (`eslint-plugin-tsdoc`). All new public interface members should have TSDoc `/** */` comments matching the style of `src/interfaces/queue-options.ts`.
- **Circular dependency check**: `yarn circular:references` (via `madge`) runs as part of `pretest`. The new `lifecycle-logger.ts` file must not introduce circular imports. It has no imports from the `src/` tree — only TypeScript primitive types.
- **`processedOn` threading**: In `processJob()` the variable `processedOn` is already defined at line 965 (`const processedOn = Date.now()`). Duration is `Date.now() - processedOn` in `handleCompleted`/`handleFailed`. The cleanest approach is to pass `processedOn` as a parameter to these handlers (adding an optional `processedOn?: number` parameter), consistent with how `span?: Span` is already passed through.

---

## Testing Strategy

### Reference test pattern

From `tests/telemetry_interface.test.ts` (MockTelemetry class pattern): inline mock class implementing the interface, Vitest explicit imports, `sinon` for call tracking, shared `IORedis` connection in `beforeAll`, UUID queue names, `removeAllQueueData` in `afterEach`.

### Mock logger structure

```typescript
// In tests/test_lifecycle_logging.ts

import * as sinon from 'sinon';
import { LifecycleLogger, LifecycleLogEntry } from '../src/interfaces';

class MockLogger implements LifecycleLogger {
  debugCalls: LifecycleLogEntry[] = [];
  warnCalls: LifecycleLogEntry[] = [];
  errorCalls: LifecycleLogEntry[] = [];

  debug(entry: LifecycleLogEntry): void { this.debugCalls.push(entry); }
  warn(entry: LifecycleLogEntry): void { this.warnCalls.push(entry); }
  error(entry: LifecycleLogEntry): void { this.errorCalls.push(entry); }

  reset() {
    this.debugCalls = [];
    this.warnCalls = [];
    this.errorCalls = [];
  }

  allCalls(): LifecycleLogEntry[] {
    return [...this.debugCalls, ...this.warnCalls, ...this.errorCalls]
      .sort((a, b) => a.timestamp - b.timestamp);
  }
}
```

### Test scenarios (10 scenarios — Large complexity, multiple lifecycle points, integration needed)

**Happy path (VAL-01):**
```typescript
it('logs job:added, job:active, and job:completed for a successful job', async () => {
  const logger = new MockLogger();
  const queue = new Queue(queueName, { connection, prefix, logger });
  const worker = new Worker(queueName, async () => {}, { connection, prefix, logger });

  const job = await queue.add('testJob', { x: 1 });
  await new Promise<void>(resolve => worker.on('completed', () => resolve()));

  const added = logger.debugCalls.find(e => e.event === 'job:added');
  expect(added).toBeDefined();
  expect(added!.jobId).toBe(job.id);
  expect(added!.queue).toBe(queueName);

  const active = logger.debugCalls.find(e => e.event === 'job:active');
  expect(active).toBeDefined();
  expect(active!.attemptsMade).toBeGreaterThanOrEqual(0);

  const completed = logger.debugCalls.find(e => e.event === 'job:completed');
  expect(completed).toBeDefined();
  expect(completed!.duration).toBeGreaterThan(0);
  expect(completed!.attemptsMade).toBeDefined();

  await worker.close();
  await queue.close();
});
```

**Error level on failure (VAL-02):**
```typescript
it('logs job:failed at error level with failedReason in data', async () => {
  const logger = new MockLogger();
  const worker = new Worker(
    queueName,
    async () => { throw new Error('boom'); },
    { connection, prefix, logger },
  );

  await queue.add('failJob', {});
  await new Promise<void>(resolve => worker.on('failed', () => resolve()));

  expect(logger.errorCalls).toHaveLength(1);
  const entry = logger.errorCalls[0];
  expect(entry.event).toBe('job:failed');
  expect(entry.data?.failedReason).toBe('boom');
  expect(entry.attemptsMade).toBeDefined();

  await worker.close();
});
```

**Warn level on retry (VAL-03):**
```typescript
it('logs job:retrying at warn level when job is configured with attempts > 1', async () => {
  const logger = new MockLogger();
  let attempt = 0;
  const worker = new Worker(
    queueName,
    async () => {
      if (attempt++ === 0) throw new Error('first fail');
    },
    { connection, prefix, logger },
  );

  await queue.add('retryJob', {}, { attempts: 3 });
  await new Promise<void>(resolve => worker.on('completed', () => resolve()));

  const retrying = logger.warnCalls.find(e => e.event === 'job:retrying');
  expect(retrying).toBeDefined();
  expect(retrying!.data?.maxAttempts).toBe(3);

  await worker.close();
});
```

**Stalled job warn (VAL-04):**
```typescript
it('logs job:stalled at warn level when job lock expires', async () => {
  const logger = new MockLogger();
  const worker = new Worker(
    queueName,
    async () => delay(5000),
    { connection, prefix, logger, lockDuration: 1000, stalledInterval: 500, maxStalledCount: 0 },
  );

  await queue.add('stalledJob', {});
  await new Promise<void>(resolve =>
    setTimeout(async () => {
      await worker.close();
      resolve();
    }, 2000),
  );

  const stalled = logger.warnCalls.find(e => e.event === 'job:stalled');
  expect(stalled).toBeDefined();
  expect(stalled!.jobId).toBeDefined();
});
```

**No-op when logger absent (VAL-05):**
```typescript
it('produces no log calls and no errors when no logger is configured', async () => {
  const worker = new Worker(queueName, async () => {}, { connection, prefix });
  await queue.add('noLogJob', {});
  await new Promise<void>(resolve => worker.on('completed', () => resolve()));
  // No assertion needed beyond "no exceptions thrown"
  await worker.close();
});
```

**Event filter — only listed events logged (VAL-06):**
```typescript
it('only logs events present in logEvents filter', async () => {
  const logger = new MockLogger();
  const worker = new Worker(
    queueName,
    async () => {},
    { connection, prefix, logger, logEvents: ['job:completed', 'job:failed'] },
  );
  const q = new Queue(queueName, { connection, prefix, logger, logEvents: ['job:completed', 'job:failed'] });

  await q.add('filteredJob', {});
  await new Promise<void>(resolve => worker.on('completed', () => resolve()));

  expect(logger.debugCalls.find(e => e.event === 'job:added')).toBeUndefined();
  expect(logger.debugCalls.find(e => e.event === 'job:active')).toBeUndefined();
  expect(logger.debugCalls.find(e => e.event === 'job:completed')).toBeDefined();

  await worker.close();
  await q.close();
});
```

**Full lifecycle event sequence (VAL-07):**
```typescript
it('emits events in correct order across retry cycle', async () => {
  const logger = new MockLogger();
  let attempt = 0;
  const worker = new Worker(
    queueName,
    async () => { if (attempt++ === 0) throw new Error('fail first'); },
    { connection, prefix, logger },
  );

  await queue.add('cycleJob', {}, { attempts: 2 });
  await new Promise<void>(resolve => worker.on('completed', () => resolve()));

  const events = logger.allCalls().map(e => e.event);
  expect(events).toContain('job:added');
  expect(events).toContain('job:active');
  expect(events).toContain('job:completed');
  // First attempt failure produces either job:retrying or job:failed then job:retrying
  expect(events.indexOf('job:completed')).toBeGreaterThan(events.indexOf('job:active'));

  await worker.close();
});
```

**TypeScript public API exports (VAL-08):**
```typescript
it('LifecycleLogger, LifecycleLogEntry, and LifecycleEvent are importable from bullmq src', () => {
  // Compile-time check: if this test file compiles, the export contract is satisfied.
  const logger: LifecycleLogger = new MockLogger();
  const entry: LifecycleLogEntry = {
    timestamp: Date.now(),
    event: 'job:added',
    queue: 'test',
  };
  expect(logger).toBeDefined();
  expect(entry.event).toBe('job:added');
});
```

**Duration accuracy (VAL-10):**
```typescript
it('completed entry has duration within expected range for ~100ms processor', async () => {
  const logger = new MockLogger();
  const worker = new Worker(
    queueName,
    async () => { await delay(100); },
    { connection, prefix, logger },
  );

  await queue.add('timedJob', {});
  await new Promise<void>(resolve => worker.on('completed', () => resolve()));

  const completed = logger.debugCalls.find(e => e.event === 'job:completed');
  expect(completed!.duration).toBeGreaterThan(80);
  expect(completed!.duration).toBeLessThan(500);

  await worker.close();
}, 10000);
```

**Lazy construction — filtered events do not allocate entry object:**
```typescript
it('shouldLog returns false for events not in logEvents — verifiable via spy on Date.now', () => {
  // Unit test of QueueBase.shouldLog directly
  // Instantiate a Queue with logEvents: ['job:completed']
  // Call shouldLog('job:added') → expect false
  // Call shouldLog('job:completed') → expect true
  const queue = new Queue(queueName, {
    connection,
    prefix,
    logger: new MockLogger(),
    logEvents: ['job:completed'],
  });

  // Access via protected method — cast required in test
  const base = queue as any;
  expect(base.shouldLog('job:added')).toBe(false);
  expect(base.shouldLog('job:completed')).toBe(true);
  expect(base.shouldLog('job:failed')).toBe(false);

  // No logger configured → always false
  const noLogQueue = new Queue(`${queueName}-nolog`, { connection, prefix });
  expect((noLogQueue as any).shouldLog('job:completed')).toBe(false);

  // logger set, no logEvents → always true
  const allEventsQueue = new Queue(`${queueName}-all`, {
    connection,
    prefix,
    logger: new MockLogger(),
  });
  expect((allEventsQueue as any).shouldLog('job:added')).toBe(true);
});
```

### Test file location and naming

New file: `tests/test_lifecycle_logging.ts`

Note from `vitest.config.ts` (`exclude` field): the pattern `tests/test_*.ts` is **excluded** from Vitest runs (reserved for legacy Mocha tests). The new test file must follow the active include pattern `tests/**/*.test.ts`. The correct filename is:

```
tests/lifecycle_logging.test.ts
```
