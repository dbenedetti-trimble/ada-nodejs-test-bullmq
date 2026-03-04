**Repository**: `https://github.com/dbenedetti-trimble/ada-nodejs-test-bullmq`

---

# Dead Letter Queue Mechanism

## Context & Problem

### Problem statement

- **Who is affected?** Developers using BullMQ who need visibility into and recovery from permanently failed jobs.
- **What is the issue?** When a BullMQ job exhausts all retries or throws an `UnrecoverableError`, it lands in the queue's `failed` sorted set and stays there until cleaned up by `removeOnFail` or manual intervention. There is no built-in mechanism to route terminally failed jobs to a separate queue for inspection, alerting, or replay. Operators must poll the failed set, manually re-enqueue jobs, and hope they remember to clean up. In high-throughput systems, failed jobs get buried.
- **Why does it matter?** Dead letter queues are a fundamental reliability pattern in message-based systems (SQS, RabbitMQ, Kafka). Without one, BullMQ users build ad-hoc DLQ wrappers that duplicate logic already close to the failure path. A native DLQ that moves jobs atomically on terminal failure, preserves full failure context, and supports replay gives operators a clean recovery workflow.

### Success metrics

| Metric                                     | Baseline                       | Target                                                                                | Validation method        |
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
    queueName: 'payments-dlq', // Required: target queue name
  },
});
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
  sourceQueue: string; // Original queue name
  originalJobId: string; // Job ID in the source queue
  failedReason: string; // Error message from the final failure
  stacktrace: string[]; // Full stacktrace array from all attempts
  attemptsMade: number; // Total attempts before DLQ
  deadLetteredAt: number; // Timestamp of DLQ movement
  originalTimestamp: number; // When the job was originally created
  originalOpts: JobsOptions; // Original job options (attempts, backoff, delay, etc.)
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
const dlq = new Queue('payments-dlq', { connection });

// Count of jobs in the DLQ
const count = await dlq.getDeadLetterCount();

// Paginated list of DLQ jobs (ordered by arrival time, newest first)
const jobs = await dlq.getDeadLetterJobs(0, 9); // first 10 jobs

// Get a specific DLQ job by ID
const job = await dlq.peekDeadLetter(jobId);
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
const dlq = new Queue('payments-dlq', { connection });

// Replay a single job back to its original queue
const newJobId = await dlq.replayDeadLetter(jobId);
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
const dlq = new Queue('payments-dlq', { connection });

// Replay all DLQ jobs back to their original queues
const count = await dlq.replayAllDeadLetters();

// Replay only jobs matching a filter
const count = await dlq.replayAllDeadLetters({
  name: 'send-email', // Filter by original job name
  failedReason: 'ETIMEDOUT', // Filter by substring in failure reason
});

// Purge all DLQ jobs
const count = await dlq.purgeDeadLetters();

// Purge with filter
const count = await dlq.purgeDeadLetters({
  name: 'send-email',
});
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

| File                               | Changes                                                                                                                                     |
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
  queueName: string;
}

interface DeadLetterMetadata {
  sourceQueue: string;
  originalJobId: string;
  failedReason: string;
  stacktrace: string[];
  attemptsMade: number;
  deadLetteredAt: number;
  originalTimestamp: number;
  originalOpts: JobsOptions;
}

interface DeadLetterFilter {
  name?: string;
  failedReason?: string;
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
