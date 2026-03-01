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

