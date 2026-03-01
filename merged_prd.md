# Product Requirements Document (PRD)
**Repository**: `https://github.com/dbenedetti-trimble/ada-nodejs-test-bullmq`

---


# Dead Letter Queue Mechanism


## Context & Problem


### Problem statement

- **Who is affected?** Developers using BullMQ who need visibility into and recovery from permanently failed jobs.
- **What is the issue?** When a BullMQ job exhausts all retries or throws an `UnrecoverableError`, it lands in the queue's `failed` sorted set and stays there until cleaned up by `removeOnFail` or manual intervention. There is no built-in mechanism to route terminally failed jobs to a separate queue for inspection, alerting, or replay. Operators must poll the failed set, manually re-enqueue jobs, and hope they remember to clean up. In high-throughput systems, failed jobs get buried.
- **Why does it matter?** Dead letter queues are a fundamental reliability pattern in message-based systems (SQS, RabbitMQ, Kafka). Without one, BullMQ users build ad-hoc DLQ wrappers that duplicate logic already close to the failure path. A native DLQ that moves jobs atomically on terminal failure, preserves full failure context, and supports replay gives operators a clean recovery workflow.

### Success metrics


|                   Metric                   |            Baseline            |                                        Target                                         |    Validation method     |
| ------------------------------------------ | ------------------------------ | ------------------------------------------------------------------------------------- | ------------------------ |
| Terminal failures routed to DLQ atomically | Jobs land in `failed` set only | Jobs moved to DLQ queue on terminal failure in a single Lua script                    | Integration tests        |
| DLQ metadata preserved                     | `failedReason` only            | Original queue, attempt history, timestamps, full stacktrace retained on DLQ job      | Integration tests        |
| DLQ inspection API                         | None                           | `getDeadLetterCount()`, `getDeadLetterJobs()`, `peekDeadLetter()` return correct data | Unit + integration tests |
| Replay from DLQ                            | None                           | `replayDeadLetter()` re-enqueues job to original queue with reset attempts            | Integration tests        |
| Bulk replay and purge                      | None                           | `replayAllDeadLetters()` and `purgeDeadLetters()` with optional filtering             | Integration tests        |
| No DLQ configured = current behavior       | Current behavior               | Identical failure behavior when `deadLetterQueue` option is absent                    | Regression tests         |
| All existing tests pass                    | 100% pass                      | 100% pass (no regressions)                                                            | `npm test` with Redis    |
| TypeScript compiles                        | Clean                          | Clean                                                                                 | `npm run tsc:all`        |
| Lint clean                                 | Clean                          | Clean                                                                                 | `npm run lint`           |


## Scope & Constraints


### In scope

- `deadLetterQueue` configuration option on Worker (target queue name or Queue instance)
- Atomic job movement from active to DLQ on terminal failure (retries exhausted or `UnrecoverableError`)
- DLQ metadata: original queue name, failure reason, full stacktrace, attempt history, all timestamps
- Queue methods for DLQ inspection: `getDeadLetterCount()`, `getDeadLetterJobs(start, end)`, `peekDeadLetter(jobId)`
- Replay mechanism: `replayDeadLetter(jobId)` re-enqueues to original queue with reset attempt count
- Bulk operations: `replayAllDeadLetters(filter?)`, `purgeDeadLetters(filter?)`
- New Lua scripts for atomic DLQ operations
- Integration tests covering the full lifecycle: add, process, fail, DLQ, inspect, replay
- QueueEvents support: DLQ movement emits events observable via existing event infrastructure

### Out of scope

- DLQ-specific QueueEvents class (use existing QueueEvents on the DLQ queue)
- DLQ retention policies (use existing `removeOnFail` / `clean()` on the DLQ queue)
- Automatic replay scheduling (replay is manual or caller-driven)
- DLQ for stalled jobs (stalled recovery already has its own mechanism via `maxStalledCount`)
- Cross-queue DLQ (DLQ is always a single target queue per Worker)
- UI / dashboard for DLQ inspection
- Changes to the Python, Elixir, or PHP implementations

### Dependencies & Risks

- **Atomic Lua operations**: DLQ movement must be atomic with the failure operation. This means extending the `moveToFinished` Lua script (or adding a new script called from the same pipeline) to conditionally route to a DLQ queue's waiting list instead of the failed sorted set. The main risk is modifying `moveToFinished-14.lua`, the most critical Lua script in the codebase.
- **Cross-queue Redis keys**: BullMQ prefixes all keys with `{prefix}:{queueName}:`. Moving a job to a different queue means writing to keys with a different queue name prefix. Redis Cluster requires all keys in a Lua script to hash to the same slot. If the source and DLQ queues have different hash tags, atomicity via a single Lua script is not possible in cluster mode. The DLQ queue name should use the same hash tag as the source queue, or the implementation should handle this via a two-step approach (remove from source, add to DLQ) with appropriate documentation about cluster limitations.
- **Lua script compilation**: After modifying or adding Lua scripts, `npm run pretest` must be run to regenerate compiled scripts. Tests will fail with script hash mismatches otherwise.
- **Test isolation**: BullMQ tests run with `--no-file-parallelism` and share Redis state. New test files must follow the existing cleanup patterns (`removeAllQueueData` in `afterEach`).

## Functional Requirements


### DLQ-1: Worker dead letter queue configuration


**Required behavior:**


The Worker accepts an optional `deadLetterQueue` in its options:


```typescript
const worker = new Worker('payments', processor, {
  connection,
  deadLetterQueue: {
    queueName: 'payments-dlq',  // Required: target queue name
  },
})
```


When configured, jobs that reach terminal failure are moved to the DLQ queue instead of the `failed` sorted set.


**Acceptance criteria:**

- Worker accepts `deadLetterQueue` option with a `queueName` string
- When `deadLetterQueue` is not configured, failure behavior is identical to current (job goes to `failed` set)
- Worker validates that `queueName` is a non-empty string at construction time
- The DLQ queue does not need to be pre-created; it is initialized on first use (standard BullMQ queue behavior)
- The DLQ queue uses the same Redis connection and prefix as the source queue

### DLQ-2: Atomic job movement to DLQ on terminal failure


**Required behavior:**


When a job reaches terminal failure (retries exhausted or `UnrecoverableError`), and the Worker has a `deadLetterQueue` configured:


1. The job is removed from the source queue's active list


2. A new job is created in the DLQ queue's waiting list with the original job data


3. The DLQ job includes metadata about the failure (see DLQ-3)


4. The source queue's job hash is cleaned up per existing `removeOnFail` settings


5. Steps 1-4 happen atomically in a single Lua script execution


Jobs that are retried (still have attempts remaining and did not throw `UnrecoverableError`) follow the normal retry path. Only terminal failures trigger DLQ movement.


**Acceptance criteria:**

- Job with `attempts: 3` that fails 3 times ends up in the DLQ, not the `failed` set
- Job that throws `UnrecoverableError` on first attempt goes directly to the DLQ
- Job with `attempts: 3` that fails twice but succeeds on third attempt does NOT go to the DLQ
- DLQ movement and source cleanup happen atomically (no intermediate state visible to other clients)
- The `failed` event is still emitted on the source queue's events stream (for backwards compatibility)
- A new `deadLettered` event is emitted with `{ jobId, queue, deadLetterQueue, failedReason }`
- If the DLQ queue does not exist in Redis yet, the Lua script creates the necessary keys

### DLQ-3: DLQ job metadata


**Required behavior:**


When a job is moved to the DLQ, the DLQ job preserves the original job data and adds failure context:


```typescript
interface DeadLetterMetadata {
  sourceQueue: string        // Original queue name
  originalJobId: string      // Job ID in the source queue
  failedReason: string       // Error message from the final failure
  stacktrace: string[]       // Full stacktrace array from all attempts
  attemptsMade: number       // Total attempts before DLQ
  deadLetteredAt: number     // Timestamp of DLQ movement
  originalTimestamp: number  // When the job was originally created
  originalOpts: JobsOptions  // Original job options (attempts, backoff, delay, etc.)
}
```


The metadata is stored in the DLQ job's `data` field alongside the original job data:


```typescript
{
  ...originalJobData,
  _dlqMeta: DeadLetterMetadata
}
```


**Acceptance criteria:**

- DLQ job data contains all original job data fields unchanged
- `_dlqMeta.sourceQueue` matches the source queue name
- `_dlqMeta.originalJobId` matches the job's ID in the source queue
- `_dlqMeta.failedReason` contains the error message from the final attempt
- `_dlqMeta.stacktrace` contains stacktraces from all attempts (not just the last one)
- `_dlqMeta.attemptsMade` equals the total number of attempts made
- `_dlqMeta.deadLetteredAt` is a valid timestamp within a reasonable range of the failure time
- `_dlqMeta.originalTimestamp` matches the original job's `timestamp` field
- `_dlqMeta.originalOpts` contains the original job options
- The DLQ job name matches the original job name

### DLQ-4: DLQ inspection API


**Required behavior:**


The Queue class gains methods for inspecting its dead letter contents (when used as a DLQ queue):


```typescript
const dlq = new Queue('payments-dlq', { connection })

// Count of jobs in the DLQ
const count = await dlq.getDeadLetterCount()

// Paginated list of DLQ jobs (ordered by arrival time, newest first)
const jobs = await dlq.getDeadLetterJobs(0, 9)  // first 10 jobs

// Get a specific DLQ job by ID
const job = await dlq.peekDeadLetter(jobId)
```


Since the DLQ is a regular BullMQ queue, these methods are convenience wrappers around existing queue getter patterns. `getDeadLetterJobs` returns jobs from the `waiting` state (where DLQ jobs land). `getDeadLetterCount` returns the waiting count. `peekDeadLetter` is equivalent to `getJob`.


**Acceptance criteria:**

- `getDeadLetterCount()` returns the number of jobs in the DLQ queue's waiting state
- `getDeadLetterJobs(0, 9)` returns up to 10 jobs ordered by arrival (newest first)
- `getDeadLetterJobs(10, 19)` returns the next page
- `peekDeadLetter(jobId)` returns the full job with data and `_dlqMeta`
- `peekDeadLetter('nonexistent')` returns `undefined`
- All methods work on any Queue instance (not just queues created as DLQs)

### DLQ-5: Replay from DLQ


**Required behavior:**


A DLQ job can be replayed back to its original queue:


```typescript
const dlq = new Queue('payments-dlq', { connection })

// Replay a single job back to its original queue
const newJobId = await dlq.replayDeadLetter(jobId)
```


Replay:


1. Reads the DLQ job's data and `_dlqMeta`


2. Creates a new job in the source queue (`_dlqMeta.sourceQueue`) with the original data (without `_dlqMeta`)


3. The new job has reset `attempts` count (starts from 0) but retains the original job options (attempts limit, backoff, etc.)


4. Removes the job from the DLQ


5. Returns the new job's ID


**Acceptance criteria:**

- Replayed job appears in the source queue's waiting state
- Replayed job has the original data without `_dlqMeta`
- Replayed job retains original job options (attempts, backoff, priority, delay if applicable)
- Replayed job's attempt count starts at 0
- The DLQ job is removed after successful replay
- Replaying a non-existent job ID throws an error
- Replaying a job whose source queue name cannot be determined throws an error
- The replayed job gets a new job ID (not the original)

### DLQ-6: Bulk replay and purge


**Required behavior:**


```typescript
const dlq = new Queue('payments-dlq', { connection })

// Replay all DLQ jobs back to their original queues
const count = await dlq.replayAllDeadLetters()

// Replay only jobs matching a filter
const count = await dlq.replayAllDeadLetters({
  name: 'send-email',          // Filter by original job name
  failedReason: 'ETIMEDOUT',   // Filter by substring in failure reason
})

// Purge all DLQ jobs
const count = await dlq.purgeDeadLetters()

// Purge with filter
const count = await dlq.purgeDeadLetters({
  name: 'send-email',
})
```


**Acceptance criteria:**

- `replayAllDeadLetters()` replays all jobs and returns the count replayed
- `replayAllDeadLetters({ name: 'X' })` only replays jobs with name `X`
- `replayAllDeadLetters({ failedReason: 'timeout' })` only replays jobs whose `_dlqMeta.failedReason` contains "timeout" (case-insensitive substring match)
- `purgeDeadLetters()` removes all DLQ jobs and returns the count removed
- `purgeDeadLetters({ name: 'X' })` only removes jobs with name `X`
- Filters can be combined: `{ name: 'X', failedReason: 'Y' }` matches both conditions (AND)
- Empty DLQ returns count 0 for both operations
- Bulk replay creates jobs in the correct source queues (different DLQ jobs may have different source queues)

## Technical Solution


### Architecture & Components


**New files:**


```text
src/
├── interfaces/
│   └── dead-letter-options.ts      # DeadLetterQueueOptions, DeadLetterMetadata, DeadLetterFilter interfaces
├── classes/
│   └── (modifications to queue.ts, worker.ts, job.ts, scripts.ts)
commands/
├── moveToDeadLetter-7.lua          # Atomic move from active to DLQ (called from moveToFinished path)
├── replayFromDeadLetter-4.lua      # Atomic replay: read DLQ job, create in source, remove from DLQ
└── purgeDeadLetters-2.lua          # Bulk remove DLQ jobs with optional filtering
```


**Modified files:**


|                File                |                                                                   Changes                                                                   |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/interfaces/worker-options.ts` | Add `deadLetterQueue?: DeadLetterQueueOptions`                                                                                              |
| `src/interfaces/index.ts`          | Export new interfaces                                                                                                                       |
| `src/classes/worker.ts`            | Pass DLQ config to Scripts, emit `deadLettered` event                                                                                       |
| `src/classes/job.ts`               | Extend `moveToFailed` to pass DLQ target when configured                                                                                    |
| `src/classes/scripts.ts`           | Add `moveToDeadLetter()`, `replayFromDeadLetter()`, `purgeDeadLetters()` methods                                                            |
| `src/classes/queue.ts`             | Add `getDeadLetterCount()`, `getDeadLetterJobs()`, `peekDeadLetter()`, `replayDeadLetter()`, `replayAllDeadLetters()`, `purgeDeadLetters()` |
| `src/classes/queue-keys.ts`        | No changes needed (DLQ is a separate queue with its own keys)                                                                               |


### Lua script design


**`moveToDeadLetter-7.lua`:**


This script is invoked from the `moveToFinished` path when a job reaches terminal failure and a DLQ is configured. It replaces the normal "add to failed set" step with:


1. LREM the job from the source queue's active list


2. Read the job's hash data (name, data, opts, stacktrace, attemptsMade, timestamp)


3. Construct the DLQ job data with `_dlqMeta` embedded


4. XADD to the source queue's events stream (`deadLettered` event)


5. Create the job hash in the DLQ queue's keyspace


6. LPUSH the job ID to the DLQ queue's waiting list


7. XADD to the DLQ queue's events stream (`waiting` event)


8. Clean up the source job per `removeOnFail` settings


9. Return the DLQ job ID


KEYS: source active key, source job hash key, source events stream, DLQ waiting key, DLQ job hash key, DLQ events stream, DLQ meta key


The script follows the same pattern as `moveToFinished-14.lua` for argument packing and error codes.


**`replayFromDeadLetter-4.lua`:**


1. Read the DLQ job hash


2. Extract `_dlqMeta` to determine source queue and original data


3. Create a new job in the source queue (hash + LPUSH to waiting)


4. Remove the DLQ job (DEL hash, LREM from waiting/active)


5. Emit events on both queues


6. Return the new job ID


KEYS: DLQ job hash key, DLQ waiting key, source waiting key, source job hash key


**`purgeDeadLetters-2.lua`:**


1. Scan jobs in the DLQ waiting list


2. For each job matching the filter (by name, failedReason substring): DEL hash, LREM from list


3. Return count of removed jobs


KEYS: DLQ waiting key, DLQ meta key


### Integration with existing failure path


The change to the failure path is minimal. In `Job.moveToFailed()`, when `shouldRetryJob()` returns false (terminal failure):

- **Current**: calls `scripts.moveToFinished()` with target `'failed'`
- **With DLQ**: if `worker.opts.deadLetterQueue` is configured, calls `scripts.moveToDeadLetter()` instead. If DLQ is not configured, the existing `moveToFinished` path is unchanged.

This keeps the DLQ as an additive code path. The existing `moveToFinished` Lua script is not modified.


### Interface definitions


```typescript
interface DeadLetterQueueOptions {
  queueName: string
}

interface DeadLetterMetadata {
  sourceQueue: string
  originalJobId: string
  failedReason: string
  stacktrace: string[]
  attemptsMade: number
  deadLetteredAt: number
  originalTimestamp: number
  originalOpts: JobsOptions
}

interface DeadLetterFilter {
  name?: string
  failedReason?: string
}
```


### Dependency changes


None. All functionality uses existing Redis commands and BullMQ patterns.


## Validation Contract


### VAL-01: DLQ not configured, failure behavior unchanged


```text
GIVEN a Worker without deadLetterQueue option
AND a job with attempts: 2
WHEN the job fails twice
THEN the job is in the source queue's failed set
AND no DLQ queue keys exist in Redis
```


### VAL-02: Job routed to DLQ after exhausting retries


```text
GIVEN a Worker with deadLetterQueue: { queueName: 'test-dlq' }
AND a job with attempts: 3
WHEN the job fails 3 times
THEN the job is NOT in the source queue's failed set
AND a job exists in the 'test-dlq' queue's waiting state
AND the DLQ job data contains _dlqMeta with sourceQueue, failedReason, attemptsMade: 3
```


### VAL-03: UnrecoverableError goes directly to DLQ


```text
GIVEN a Worker with deadLetterQueue configured
AND a processor that throws UnrecoverableError
WHEN a job is processed
THEN the job goes to the DLQ after 1 attempt
AND _dlqMeta.attemptsMade is 1
```


### VAL-04: Successful job does not go to DLQ


```text
GIVEN a Worker with deadLetterQueue configured
AND a job with attempts: 3
WHEN the job fails twice but succeeds on the third attempt
THEN the job is in the completed set
AND no job exists in the DLQ
```


### VAL-05: Retried job does not go to DLQ until retries exhausted


```text
GIVEN a Worker with deadLetterQueue configured
AND a job with attempts: 3 and backoff: { type: 'fixed', delay: 100 }
WHEN the job fails on the first attempt
THEN the job is in the delayed state (not in DLQ)
WHEN the job fails on all 3 attempts
THEN the job is in the DLQ
```


### VAL-06: DLQ metadata is complete


```text
GIVEN a Worker with deadLetterQueue configured on queue 'orders'
AND a job created with data { orderId: 123 }, options { attempts: 2, backoff: { type: 'fixed', delay: 100 } }
WHEN the job fails twice with error "Connection refused"
THEN the DLQ job data contains { orderId: 123 }
AND _dlqMeta.sourceQueue is 'orders'
AND _dlqMeta.failedReason is 'Connection refused'
AND _dlqMeta.stacktrace is an array with 2 entries
AND _dlqMeta.attemptsMade is 2
AND _dlqMeta.deadLetteredAt is a valid timestamp
AND _dlqMeta.originalOpts.attempts is 2
```


### VAL-07: DLQ job preserves original job name


```text
GIVEN a Worker with deadLetterQueue configured
WHEN a job named 'send-email' fails terminally
THEN the DLQ job name is 'send-email'
```


### VAL-08: deadLettered event emitted


```text
GIVEN a Worker with deadLetterQueue configured
AND QueueEvents listening on the source queue
WHEN a job fails terminally and is moved to DLQ
THEN a 'deadLettered' event is emitted with { jobId, deadLetterQueue }
```


### VAL-09: getDeadLetterCount returns correct count


```text
GIVEN 5 jobs have been dead-lettered to 'test-dlq'
WHEN I call dlqQueue.getDeadLetterCount()
THEN the result is 5
```


### VAL-10: getDeadLetterJobs returns paginated results


```text
GIVEN 15 jobs have been dead-lettered
WHEN I call dlqQueue.getDeadLetterJobs(0, 9)
THEN 10 jobs are returned
WHEN I call dlqQueue.getDeadLetterJobs(10, 14)
THEN 5 jobs are returned
```


### VAL-11: peekDeadLetter returns job with metadata


```text
GIVEN a job has been dead-lettered with ID 'dlq-123'
WHEN I call dlqQueue.peekDeadLetter('dlq-123')
THEN the returned job includes data with _dlqMeta
AND _dlqMeta.sourceQueue is set correctly
```


### VAL-12: peekDeadLetter returns undefined for missing job


```text
GIVEN no job with ID 'nonexistent' in the DLQ
WHEN I call dlqQueue.peekDeadLetter('nonexistent')
THEN the result is undefined
```


### VAL-13: replayDeadLetter re-enqueues to source queue


```text
GIVEN a job originally from queue 'orders' is in the DLQ
WHEN I call dlqQueue.replayDeadLetter(jobId)
THEN a new job appears in the 'orders' queue's waiting state
AND the new job has the original data without _dlqMeta
AND the new job has attemptsMade: 0
AND the new job retains the original job options
AND the DLQ job is removed
```


### VAL-14: replayDeadLetter returns new job ID


```text
GIVEN a dead-lettered job
WHEN I call dlqQueue.replayDeadLetter(jobId)
THEN a string job ID is returned
AND the returned ID is different from the original job ID
```


### VAL-15: replayDeadLetter throws for non-existent job


```text
GIVEN no job with ID 'nonexistent' in the DLQ
WHEN I call dlqQueue.replayDeadLetter('nonexistent')
THEN an error is thrown indicating the job was not found
```


### VAL-16: replayAllDeadLetters replays all jobs


```text
GIVEN 3 dead-lettered jobs from queue 'orders'
WHEN I call dlqQueue.replayAllDeadLetters()
THEN 3 new jobs appear in 'orders' queue
AND the DLQ is empty
AND the return value is 3
```


### VAL-17: replayAllDeadLetters with name filter


```text
GIVEN 2 dead-lettered jobs named 'send-email' and 1 named 'charge-card'
WHEN I call dlqQueue.replayAllDeadLetters({ name: 'send-email' })
THEN 2 jobs are replayed
AND the 'charge-card' job remains in the DLQ
AND the return value is 2
```


### VAL-18: replayAllDeadLetters with failedReason filter


```text
GIVEN dead-lettered jobs with reasons "ETIMEDOUT", "ECONNREFUSED", "ETIMEDOUT"
WHEN I call dlqQueue.replayAllDeadLetters({ failedReason: 'ETIMEDOUT' })
THEN 2 jobs are replayed
AND the ECONNREFUSED job remains
```


### VAL-19: purgeDeadLetters removes all


```text
GIVEN 5 dead-lettered jobs
WHEN I call dlqQueue.purgeDeadLetters()
THEN the DLQ is empty
AND the return value is 5
```


### VAL-20: purgeDeadLetters with filter


```text
GIVEN 3 dead-lettered jobs, 2 named 'send-email', 1 named 'charge-card'
WHEN I call dlqQueue.purgeDeadLetters({ name: 'send-email' })
THEN 2 jobs are removed
AND the 'charge-card' job remains
AND the return value is 2
```


### VAL-21: Bulk replay handles multiple source queues


```text
GIVEN 2 dead-lettered jobs from queue 'orders' and 1 from queue 'notifications'
WHEN I call dlqQueue.replayAllDeadLetters()
THEN 2 jobs appear in 'orders' and 1 in 'notifications'
AND the DLQ is empty
```


### VAL-22: Empty DLQ operations return zero


```text
GIVEN an empty DLQ
WHEN I call dlqQueue.getDeadLetterCount()
THEN the result is 0
WHEN I call dlqQueue.replayAllDeadLetters()
THEN the result is 0
WHEN I call dlqQueue.purgeDeadLetters()
THEN the result is 0
```


### VAL-23: No regressions in existing test suite


```text
GIVEN all DLQ changes are applied
WHEN I run npm test with Redis running via docker-compose
THEN all existing tests pass
AND npm run lint passes
AND npm run tsc:all passes
```


---

# Technical Context
# Technical Context: Dead Letter Queue Mechanism

## Verified Tech Stack

From `package.json` (dependencies section):
- **Language**: TypeScript 5.9.3 (`typescript: 5.9.3` in devDependencies)
- **Runtime**: Node.js (types: `@types/node 18.19.130`)
- **Redis client**: ioredis 5.9.3
- **Serialization**: msgpackr 1.11.5 (used by `Scripts` class for packing Lua args)
- **ID generation**: uuid 11.1.0 (used for job IDs and queue tokens)
- **Test framework**: Vitest 4.0.18 (`--no-file-parallelism` flag enforced)
- **Package manager**: Yarn 1.22.22 (`packageManager` field in package.json)

---

## Relevant Files & Patterns

### Files requiring modification

- `src/interfaces/worker-options.ts` — `WorkerOptions` interface; add `deadLetterQueue?: DeadLetterQueueOptions` following the pattern of existing optional fields such as `limiter?: RateLimiterOptions`
- `src/interfaces/index.ts` — barrel export; add `export * from './dead-letter-options'` following the alphabetical `export *` pattern
- `src/classes/worker.ts` — `handleFailed()` method (line 1100); the terminal failure branch calls `job.moveToFailed()` then `this.emit('failed', ...)`. The DLQ branch inserts between these two calls: check `this.opts.deadLetterQueue`, call `scripts.moveToDeadLetter()`, emit `deadLettered` event in addition to the existing `failed` emit
- `src/classes/job.ts` — `moveToFailed()` method (lines 804–893); the `else` branch at line 862 handles terminal failure. When DLQ is configured the `scripts.moveToDeadLetter()` call replaces `scripts.moveToFinished()` for terminal failures. The `shouldRetryJob()` method (line 774) determines terminal vs retry — it is NOT modified
- `src/classes/scripts.ts` — `Scripts` class; add `moveToDeadLetterArgs()`, `moveToDeadLetter()`, `replayFromDeadLetter()`, and `purgeDeadLetters()` methods following the same pattern as `moveToFailedArgs()` (line 980) and `moveToFinished()` (line 778)
- `src/classes/queue.ts` — `Queue` class; add six public methods: `getDeadLetterCount()`, `getDeadLetterJobs()`, `peekDeadLetter()`, `replayDeadLetter()`, `replayAllDeadLetters()`, `purgeDeadLetters()`
- `src/classes/queue-getters.ts` — reference for the `getWaiting()` / `getWaitingCount()` / `getJob()` patterns that DLQ inspection methods delegate to

### New files to create

- `src/interfaces/dead-letter-options.ts` — three interfaces: `DeadLetterQueueOptions`, `DeadLetterMetadata`, `DeadLetterFilter`
- `src/commands/moveToDeadLetter-7.lua` — atomic move from source active list to DLQ waiting list; 7 KEYS (source active, source job hash, source events stream, DLQ waiting, DLQ job hash, DLQ events stream, DLQ meta key)
- `src/commands/replayFromDeadLetter-4.lua` — atomic replay: read DLQ job hash, create in source queue, remove from DLQ; 4 KEYS (DLQ job hash, DLQ waiting, source waiting, source job hash)
- `src/commands/purgeDeadLetters-2.lua` — scan and bulk-remove DLQ waiting list with optional filter; 2 KEYS (DLQ waiting, DLQ meta key)

### Existing code patterns to follow

**Lua script naming convention** (from `src/commands/` directory structure):
The numeric suffix in each filename equals the number of `KEYS` the script declares, e.g. `moveToFinished-14.lua` uses 14 KEYS. New scripts must follow this `commandName-{numKeys}.lua` pattern.

**Lua script header structure** (from `src/commands/moveToFinished-14.lua`, header block):
Each script has a block comment listing all KEYS, ARGV, Output codes, and Events, then `local rcall = redis.call`, then `--- @include` directives for shared functions from `src/commands/includes/`.

**Lua include library** (from `src/commands/includes/` directory):
Reusable Lua functions available via `--- @include` directives:
- `storeJob.lua` — `storeJob(eventsKey, jobIdKey, jobId, name, data, opts, timestamp, ...)` — stores a job hash and emits `added` event
- `removeJobKeys.lua` — `removeJobKeys(jobKey)` — DELetes all sub-keys for a job
- `trimEvents.lua` — `trimEvents(metaKey, eventStreamKey)` — trims event stream before emitting
- `getTargetQueueList.lua`, `addJobInTargetList.lua` — helpers for queue routing

**Lua args packing** (from `src/classes/scripts.ts`, `moveToFinishedArgs()` method, line 742):
Options are packed with `msgpackr` (`pack(...)`) and passed as a single ARGV entry; Lua unpacks with `cmsgpack.unpack(ARGV[N])`. All keys are passed as a flat array prepended to args via `keys.concat(args)`.

**`execCommand` dispatch** (from `src/classes/scripts.ts`, `execCommand()` method, line 82):
Commands are dispatched as `client['commandName:version'](args)`. The command name maps directly to the Lua filename prefix (e.g. `'moveToDeadLetter'` → `moveToDeadLetter-7.lua`). Scripts are registered during `pretest` via `scripts/commandTransform.js`.

**Script build pipeline** (from `package.json` scripts section):
`pretest` runs `clean:scripts → generate:raw:scripts → transform:commands → circular:references`. After adding any `.lua` file to `src/commands/`, run `npm run pretest` to regenerate `src/scripts/`. Tests will fail with script hash mismatches if this step is skipped.

**Queue key format** (from `src/classes/queue-keys.ts`, `QueueKeys.toKey()` method):
All Redis keys follow `{prefix}:{queueName}:{type}`. When writing to the DLQ queue's keyspace from within a Lua script, the DLQ queue's keys must be constructed as `prefix .. ":" .. dlqQueueName .. ":" .. keyType`. Both source and DLQ queue must share the same prefix.

**`moveToFinishedKeys` array** (from `src/classes/scripts.ts`, constructor, line 54–74):
A 14-element array with fixed slots; slots 10–13 are set per-call. For `moveToDeadLetter`, a separate keys array is constructed rather than reusing `moveToFinishedKeys`, to avoid mutating shared state.

**Terminal failure detection** (from `src/classes/job.ts`, `shouldRetryJob()`, line 774):
Returns `[false, 0]` when `attemptsMade + 1 >= opts.attempts` OR `err instanceof UnrecoverableError`. The DLQ branch activates only in this `false` return case, inside `moveToFailed()` at the `else` block starting line 861.

**Queue inspection methods** (from `src/classes/queue-getters.ts`, `getWaiting()` line 310, `getWaitingCount()` line 294, `getJob()` line 14):
- `getDeadLetterCount()` → delegates to `this.getWaitingCount()` (DLQ jobs land in `wait` list)
- `getDeadLetterJobs(start, end)` → delegates to `this.getWaiting(start, end)`
- `peekDeadLetter(jobId)` → delegates to `this.getJob(jobId)` (returns `undefined` if not found)

**Event stream emission** (from `src/classes/queue-events.ts`, `QueueEventsListener` interface):
Events are written to Redis streams via `XADD eventsKey * "event" eventName ...` in Lua. The `deadLettered` event must be added to `QueueEventsListener` with the signature: `deadLettered: (args: { jobId: string; deadLetterQueue: string }, id: string) => void`.

**Worker `WorkerListener` pattern** (from `src/classes/worker.ts`, `WorkerListener` interface, line 53):
The `failed` event is emitted at line 1133 as `this.emit('failed', job, err, 'active')`. The `deadLettered` event should be emitted similarly after a successful DLQ move.

**Test structure** (from `tests/worker.test.ts`, test setup, lines 35–66):
```typescript
const redisHost = process.env.REDIS_HOST || 'localhost';
const prefix = process.env.BULLMQ_TEST_PREFIX || 'bull';
let queue: Queue;
let queueName: string;
let connection: IORedis;

beforeAll(async () => {
  connection = new IORedis(redisHost, { maxRetriesPerRequest: null });
});
beforeEach(async () => {
  queueName = `test-${v4()}`;
  queue = new Queue(queueName, { connection, prefix });
});
afterEach(async () => {
  await queue.close();
  await removeAllQueueData(new IORedis(redisHost), queueName);
  // For DLQ tests: also call removeAllQueueData for the DLQ queue name
});
afterAll(async () => {
  await connection.quit();
});
```

---

## Integration Points

**`Job.moveToFailed()` → terminal failure branch** (`src/classes/job.ts`, line 861):
The single integration point for DLQ routing. When `shouldRetry === false` and `worker.opts.deadLetterQueue` is set, replace the `scripts.moveToFinished()` call with `scripts.moveToDeadLetter()`. The existing `moveToFinished-14.lua` script is **not modified**.

**`Worker.handleFailed()` → event emission** (`src/classes/worker.ts`, line 1127–1148):
After `job.moveToFailed()` returns, the worker emits `failed`. For DLQ-routed jobs, also emit `deadLettered` with `{ jobId, deadLetterQueue: opts.deadLetterQueue.queueName }`. The `failed` event must still be emitted for backwards compatibility.

**`Scripts` class → new Lua command methods** (`src/classes/scripts.ts`):
Three new public methods bind the new Lua scripts to TypeScript. Each follows the `execCommand(client, 'commandName', args)` dispatch pattern. Negative return values from Lua map to thrown errors via `finishedErrors()` (existing helper).

**`Queue` class → DLQ inspection and replay API** (`src/classes/queue.ts`):
Six new public methods on `Queue`. `getDeadLetterCount()`, `getDeadLetterJobs()`, and `peekDeadLetter()` are thin wrappers over existing `QueueGetters` methods. `replayDeadLetter()` and bulk methods call `Scripts` methods. Replay creates a new job in the source queue using the existing `Queue.add()` method on a dynamically created source `Queue` instance (sharing connection and prefix).

**`QueueEvents` → `deadLettered` event** (`src/classes/queue-events.ts`):
Add `deadLettered` to the `QueueEventsListener` interface. The event is emitted by `moveToDeadLetter-7.lua` via `XADD` on the source queue's events stream. No new `QueueEvents` subclass is needed.

**`WorkerOptions` interface → `deadLetterQueue` field** (`src/interfaces/worker-options.ts`):
Add `deadLetterQueue?: DeadLetterQueueOptions`. Validation (non-empty `queueName`) must happen at Worker construction time, following the pattern of other option validations in the `Worker` constructor.

**Redis Cluster constraint** (from PRD dependencies section):
Cross-queue Lua atomicity is not possible in cluster mode when source and DLQ queues hash to different slots. The Lua script should document this limitation. For cluster environments, the DLQ `queueName` should use the same hash tag as the source queue (e.g. `{payments}` in both names), or a two-step non-atomic approach is used with documentation.

**Impact boundary**: Changes are additive. When `deadLetterQueue` is absent, all existing code paths are unchanged. The `moveToFinished-14.lua` script is not touched.

---

## Data Persistence

### DLQ job Redis data model

DLQ jobs are stored as standard BullMQ job hashes in the DLQ queue's keyspace. The job hash key format is `{prefix}:{dlqQueueName}:{dlqJobId}` and stores the same fields as any BullMQ job hash (`name`, `data`, `opts`, `timestamp`, `delay`, `priority`). The `data` field is a JSON string containing both the original job data and the `_dlqMeta` object merged at the top level:

```json
{
  "originalField1": "value",
  "originalField2": 123,
  "_dlqMeta": {
    "sourceQueue": "payments",
    "originalJobId": "42",
    "failedReason": "Connection refused",
    "stacktrace": ["Error: Connection refused\n    at ...", "Error: ..."],
    "attemptsMade": 3,
    "deadLetteredAt": 1700000000000,
    "originalTimestamp": 1699999900000,
    "originalOpts": { "attempts": 3, "backoff": { "type": "fixed", "delay": 1000 } }
  }
}
```

The DLQ job is placed in the DLQ queue's `wait` list (via `LPUSH`), making it immediately accessible via all existing `waiting`-state getters.

### New TypeScript interfaces (new file `src/interfaces/dead-letter-options.ts`)

```typescript
import { JobsOptions } from '../types';

export interface DeadLetterQueueOptions {
  queueName: string;
}

export interface DeadLetterMetadata {
  sourceQueue: string;
  originalJobId: string;
  failedReason: string;
  stacktrace: string[];
  attemptsMade: number;
  deadLetteredAt: number;
  originalTimestamp: number;
  originalOpts: JobsOptions;
}

export interface DeadLetterFilter {
  name?: string;
  failedReason?: string;
}
```

### No database schema migrations

BullMQ stores all data in Redis key-value structures. No migration tooling is used; key structures are created on first use.

---

## API Definitions

### New `Queue` methods (added to `src/classes/queue.ts`)

```typescript
// Count of jobs currently in the DLQ (waiting state of this queue)
async getDeadLetterCount(): Promise<number>

// Paginated list of DLQ jobs, newest first (delegates to getWaiting)
async getDeadLetterJobs(start: number, end: number): Promise<Job[]>

// Fetch a single DLQ job by ID (returns undefined if not found)
async peekDeadLetter(jobId: string): Promise<Job | undefined>

// Replay a single DLQ job back to its source queue; returns new job ID
async replayDeadLetter(jobId: string): Promise<string>

// Replay all (or filtered) DLQ jobs; returns count replayed
async replayAllDeadLetters(filter?: DeadLetterFilter): Promise<number>

// Remove all (or filtered) DLQ jobs; returns count removed
async purgeDeadLetters(filter?: DeadLetterFilter): Promise<number>
```

### New `WorkerOptions` field (modified `src/interfaces/worker-options.ts`)

```typescript
deadLetterQueue?: DeadLetterQueueOptions;
// When set, terminal failures route to the specified queue instead of the 'failed' set
```

### New event: `deadLettered` on `QueueEventsListener` (`src/classes/queue-events.ts`)

```typescript
deadLettered: (
  args: { jobId: string; deadLetterQueue: string },
  id: string,
) => void;
```

Emitted by `moveToDeadLetter-7.lua` via XADD on the source queue's events stream after a job is successfully moved.

---

## Technical Constraints

**Lua script compilation pipeline**: After adding any `.lua` file to `src/commands/`, run `npm run pretest` before running tests. The pipeline is `clean:scripts → generate:raw:scripts → transform:commands`. Skipping this step causes runtime failures with script hash mismatches.

**`--no-file-parallelism` test execution** (from `package.json` scripts, `test` script): Tests run sequentially. New test files share the same Redis instance. Each test must use a unique UUID-based queue name and clean up with `removeAllQueueData` for both the source queue AND the DLQ queue in `afterEach`.

**Redis Cluster cross-slot limitation** (from PRD dependencies section): A single Lua script cannot atomically write to keys in different hash slots. If the DLQ `queueName` differs from the source queue name in hash tag, atomicity breaks in cluster mode. Document this clearly in the JSDoc of `deadLetterQueue` option and in the Lua script header comment.

**TypeScript compilation**: All new interfaces and method signatures must compile cleanly with `tsc && tsc -p tsconfig-cjs.json` (both ESM and CJS targets per `package.json` `tsc:all` script).

**ESLint + Prettier**: New files must pass `npm run lint`. Run `npm run prettier` on any new `.ts` files before commit. Pre-commit hooks enforce this via `lint-staged`.

---

## Testing Strategy

New test file: `tests/dead_letter_queue.test.ts`

Test setup pattern (from `tests/worker.test.ts`, lines 35–66):

```typescript
import { default as IORedis } from 'ioredis';
import { describe, beforeAll, beforeEach, afterEach, afterAll, it, expect } from 'vitest';
import { v4 } from 'uuid';
import { Queue, Worker, QueueEvents, UnrecoverableError } from '../src/classes';
import { removeAllQueueData } from '../src/utils';

describe('Dead Letter Queue', () => {
  const redisHost = process.env.REDIS_HOST || 'localhost';
  const prefix = process.env.BULLMQ_TEST_PREFIX || 'bull';
  let connection: IORedis;
  let queue: Queue;
  let dlqQueue: Queue;
  let queueName: string;
  let dlqName: string;

  beforeAll(async () => {
    connection = new IORedis(redisHost, { maxRetriesPerRequest: null });
  });
  beforeEach(async () => {
    queueName = `test-${v4()}`;
    dlqName = `${queueName}-dlq`;
    queue = new Queue(queueName, { connection, prefix });
    dlqQueue = new Queue(dlqName, { connection, prefix });
  });
  afterEach(async () => {
    await queue.close();
    await dlqQueue.close();
    await removeAllQueueData(new IORedis(redisHost), queueName);
    await removeAllQueueData(new IORedis(redisHost), dlqName);
  });
  afterAll(async () => { await connection.quit(); });
});
```

### Test scenarios (complexity: Large — 15 scenarios targeting all 23 VAL cases)

**Happy path — retry exhaustion routes to DLQ (VAL-02, VAL-06):**
```typescript
it('routes job to DLQ after exhausting retries', async () => {
  await queue.add('test-job', { orderId: 123 }, { attempts: 3 });
  const worker = new Worker(queueName, async () => { throw new Error('Connection refused'); }, {
    connection, prefix,
    deadLetterQueue: { queueName: dlqName },
  });
  await new Promise<void>(resolve => {
    worker.on('failed', async (job, err) => {
      if (job.attemptsMade >= 3) resolve();
    });
  });
  await worker.close();
  const count = await dlqQueue.getDeadLetterCount();
  expect(count).toBe(1);
  const [dlqJob] = await dlqQueue.getDeadLetterJobs(0, 0);
  expect(dlqJob.data.orderId).toBe(123);
  expect(dlqJob.data._dlqMeta.sourceQueue).toBe(queueName);
  expect(dlqJob.data._dlqMeta.attemptsMade).toBe(3);
  expect(dlqJob.data._dlqMeta.failedReason).toBe('Connection refused');
  expect(Array.isArray(dlqJob.data._dlqMeta.stacktrace)).toBe(true);
  expect(dlqJob.data._dlqMeta.stacktrace).toHaveLength(3);
});
```

**Happy path — UnrecoverableError goes directly to DLQ on first attempt (VAL-03):**
```typescript
it('routes job to DLQ immediately on UnrecoverableError', async () => {
  await queue.add('email-job', { to: 'a@b.com' }, { attempts: 5 });
  const worker = new Worker(queueName, async () => {
    throw new UnrecoverableError('Invalid payload');
  }, { connection, prefix, deadLetterQueue: { queueName: dlqName } });
  await new Promise<void>(resolve => worker.on('failed', () => resolve()));
  await worker.close();
  const count = await dlqQueue.getDeadLetterCount();
  expect(count).toBe(1);
  const [dlqJob] = await dlqQueue.getDeadLetterJobs(0, 0);
  expect(dlqJob.data._dlqMeta.attemptsMade).toBe(1);
});
```

**Edge case — successful job does NOT go to DLQ (VAL-04):**
```typescript
it('does not route successful job to DLQ', async () => {
  await queue.add('ok-job', {});
  const worker = new Worker(queueName, async () => {}, {
    connection, prefix, deadLetterQueue: { queueName: dlqName },
  });
  await new Promise<void>(resolve => worker.on('completed', () => resolve()));
  await worker.close();
  expect(await dlqQueue.getDeadLetterCount()).toBe(0);
});
```

**Edge case — no DLQ configured = current behavior unchanged (VAL-01):**
```typescript
it('preserves existing failed-set behavior when deadLetterQueue not configured', async () => {
  await queue.add('fail-job', {}, { attempts: 2 });
  const worker = new Worker(queueName, async () => { throw new Error('oops'); }, { connection, prefix });
  await new Promise<void>(resolve => worker.on('failed', (job) => {
    if (job.attemptsMade >= 2) resolve();
  }));
  await worker.close();
  const failedCount = await queue.getFailedCount();
  expect(failedCount).toBe(1);
  expect(await dlqQueue.getDeadLetterCount()).toBe(0);
});
```

**Edge case — job still retrying does NOT land in DLQ (VAL-05):**
```typescript
it('does not route job to DLQ while retries remain', async () => {
  let attempts = 0;
  await queue.add('retry-job', {}, { attempts: 3, backoff: { type: 'fixed', delay: 10 } });
  const worker = new Worker(queueName, async () => {
    attempts++;
    if (attempts < 3) throw new Error('transient');
  }, { connection, prefix, deadLetterQueue: { queueName: dlqName } });
  await new Promise<void>(resolve => worker.on('completed', () => resolve()));
  await worker.close();
  expect(await dlqQueue.getDeadLetterCount()).toBe(0);
});
```

**Edge case — `deadLettered` event emitted on source queue events stream (VAL-08):**
```typescript
it('emits deadLettered event when job is routed to DLQ', async () => {
  const queueEvents = new QueueEvents(queueName, { connection, prefix });
  await queueEvents.waitUntilReady();
  await queue.add('event-job', {}, { attempts: 1 });
  const worker = new Worker(queueName, async () => { throw new Error('fail'); }, {
    connection, prefix, deadLetterQueue: { queueName: dlqName },
  });
  const event = await new Promise<any>(resolve =>
    (queueEvents as any).on('deadLettered', resolve)
  );
  await worker.close();
  await queueEvents.close();
  expect(event.jobId).toBeDefined();
  expect(event.deadLetterQueue).toBe(dlqName);
});
```

**Inspection API — count, pagination, peek (VAL-09, VAL-10, VAL-11, VAL-12):**
```typescript
it('getDeadLetterJobs returns paginated results', async () => {
  // Dead-letter 15 jobs by running workers that always fail
  // ... (add 15 jobs, run worker, wait for all to DLQ)
  expect(await dlqQueue.getDeadLetterJobs(0, 9)).toHaveLength(10);
  expect(await dlqQueue.getDeadLetterJobs(10, 14)).toHaveLength(5);
  const job = (await dlqQueue.getDeadLetterJobs(0, 0))[0];
  const peeked = await dlqQueue.peekDeadLetter(job.id);
  expect(peeked?.data._dlqMeta).toBeDefined();
  expect(await dlqQueue.peekDeadLetter('nonexistent')).toBeUndefined();
});
```

**Replay — single job returns to source queue (VAL-13, VAL-14, VAL-15):**
```typescript
it('replayDeadLetter re-enqueues job to source queue', async () => {
  // ... dead-letter one job
  const dlqJob = (await dlqQueue.getDeadLetterJobs(0, 0))[0];
  const newJobId = await dlqQueue.replayDeadLetter(dlqJob.id);
  expect(typeof newJobId).toBe('string');
  expect(newJobId).not.toBe(dlqJob.id);
  const replayedJob = await queue.getJob(newJobId);
  expect(replayedJob).toBeDefined();
  expect(replayedJob?.data._dlqMeta).toBeUndefined();
  expect(replayedJob?.attemptsMade).toBe(0);
  expect(await dlqQueue.getDeadLetterCount()).toBe(0);
  await expect(dlqQueue.replayDeadLetter('nonexistent')).rejects.toThrow();
});
```

**Replay — bulk replay all jobs (VAL-16, VAL-21, VAL-22):**
```typescript
it('replayAllDeadLetters replays all jobs including across multiple source queues', async () => {
  // ... dead-letter 3 jobs: 2 from queueName, 1 from a second queue
  const replayed = await dlqQueue.replayAllDeadLetters();
  expect(replayed).toBe(3);
  expect(await dlqQueue.getDeadLetterCount()).toBe(0);
  // empty DLQ returns 0
  expect(await dlqQueue.replayAllDeadLetters()).toBe(0);
});
```

**Replay — filtered by name (VAL-17):**
```typescript
it('replayAllDeadLetters with name filter only replays matching jobs', async () => {
  // ... dead-letter 2 'send-email' and 1 'charge-card'
  const replayed = await dlqQueue.replayAllDeadLetters({ name: 'send-email' });
  expect(replayed).toBe(2);
  expect(await dlqQueue.getDeadLetterCount()).toBe(1);
});
```

**Replay — filtered by failedReason (VAL-18):**
```typescript
it('replayAllDeadLetters with failedReason filter uses case-insensitive substring match', async () => {
  // ... dead-letter jobs with 'ETIMEDOUT', 'ECONNREFUSED', 'etimedout'
  const replayed = await dlqQueue.replayAllDeadLetters({ failedReason: 'ETIMEDOUT' });
  expect(replayed).toBe(2); // matches 'ETIMEDOUT' and 'etimedout'
  expect(await dlqQueue.getDeadLetterCount()).toBe(1);
});
```

**Purge — all jobs (VAL-19, VAL-22):**
```typescript
it('purgeDeadLetters removes all jobs and returns count', async () => {
  // ... dead-letter 5 jobs
  expect(await dlqQueue.purgeDeadLetters()).toBe(5);
  expect(await dlqQueue.getDeadLetterCount()).toBe(0);
  expect(await dlqQueue.purgeDeadLetters()).toBe(0);
});
```

**Purge — filtered by name (VAL-20):**
```typescript
it('purgeDeadLetters with name filter only removes matching jobs', async () => {
  // ... dead-letter 2 'send-email' and 1 'charge-card'
  expect(await dlqQueue.purgeDeadLetters({ name: 'send-email' })).toBe(2);
  expect(await dlqQueue.getDeadLetterCount()).toBe(1);
});
```

**DLQ job preserves original job name (VAL-07):**
```typescript
it('DLQ job preserves original job name', async () => {
  await queue.add('send-email', { to: 'a@b.com' }, { attempts: 1 });
  // ... run worker that always fails
  const [dlqJob] = await dlqQueue.getDeadLetterJobs(0, 0);
  expect(dlqJob.name).toBe('send-email');
});
```

**Regression guard — existing tests pass unmodified (VAL-23):**
No additional test scenario needed. This is validated by running `npm test` with the full existing suite after applying changes. The test file should not break any of the 23+ existing test files.
