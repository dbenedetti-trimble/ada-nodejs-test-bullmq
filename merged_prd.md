# Product Requirements Document (PRD)
**Repository**: `https://github.com/dbenedetti-trimble/ada-nodejs-test-bullmq`

---


# Transactional Job Groups with Saga Compensation


## Context & Problem


### Problem statement

- **Who is affected?** Developers building distributed workflows where a set of jobs must either all succeed or roll back their effects.
- **What is the issue?** BullMQ has flows (parent-child DAGs) for structured dependencies, but no mechanism for treating a flat set of independent jobs as a logical transaction. When one job in a business operation fails, completed sibling jobs leave behind side effects (sent emails, charged payments, allocated inventory) with no automated way to reverse them. Developers must build bespoke compensation logic outside the queue, leading to inconsistent rollback behavior and orphaned state.
- **Why does it matter?** The saga pattern is the standard approach for distributed transactions without two-phase commit. A first-class implementation inside BullMQ would give developers atomic group semantics with automatic compensation, eliminating a common source of data inconsistency in job-driven architectures.

### Success metrics


|                Metric                 |   Baseline   |                               Target                                |   Validation method   |
| ------------------------------------- | ------------ | ------------------------------------------------------------------- | --------------------- |
| Job group creation via API            | Not possible | `addGroup()` creates a group with N jobs atomically                 | Integration tests     |
| Group completes when all jobs succeed | N/A          | Group state transitions to COMPLETED, `group:completed` event fires | Integration tests     |
| Failed job triggers compensation      | N/A          | Remaining jobs cancelled, completed jobs' compensations enqueued    | Integration tests     |
| Compensation jobs execute with retry  | N/A          | Compensation handlers run as jobs with configurable retry           | Integration tests     |
| Group state queryable                 | N/A          | `getGroupState()`, `getGroupJobs()` return accurate state           | Integration tests     |
| Manual group cancellation             | N/A          | `cancelGroup()` cancels pending jobs and triggers compensation      | Integration tests     |
| All existing tests pass               | 100% pass    | 100% pass (no regressions)                                          | `npm test` with Redis |
| TypeScript compiles                   | Clean        | Clean (no new type errors)                                          | `npm run tsc:all`     |
| Lint clean                            | Clean        | Clean                                                               | `npm run lint`        |


## Scope & Constraints


### In scope

- `JobGroup` concept: a named set of independent jobs forming a logical transaction
- Group creation API on FlowProducer: `addGroup({ name, jobs, compensation })` with atomic Redis insertion
- Group state machine: PENDING → ACTIVE → COMPLETED or ACTIVE → COMPENSATING → FAILED (or FAILED_COMPENSATION)
- Automatic compensation: when a job exhausts retries, cancel remaining group jobs and enqueue compensation handlers for already-completed jobs
- Compensation handlers as regular BullMQ jobs in a dedicated `{queueName}:compensation` queue with their own retry logic
- Group metadata stored in Redis: group ID, state, member job IDs, per-job status, compensation mapping
- Query API: `queue.getGroupState(groupId)`, `queue.getGroupJobs(groupId)`, `queue.cancelGroup(groupId)`
- Events: `group:completed`, `group:failed`, `group:compensating` emitted on QueueEvents
- New Lua scripts for atomic group state transitions
- TypeScript interfaces and type definitions for all new APIs
- Integration tests covering the full lifecycle: create → process → succeed/fail → compensate → terminal state

### Out of scope

- Nested groups (groups within groups)
- Ordered execution within a group (all jobs are independent; use flows for ordering)
- Distributed two-phase commit (this is saga, not 2PC)
- Compensation for delayed or scheduled jobs that haven't executed yet (only completed jobs get compensation)
- UI or dashboard for group monitoring
- Changes to the Python, Elixir, or PHP implementations in the repo
- Modifications to existing Lua scripts (new scripts only, unless a hook point is needed in `moveToFinished`)

### Dependencies & Risks

- **`moveToFinished` integration**: The `moveToFinished-14.lua` script is the central point where jobs transition to completed/failed. Group-aware behavior must hook into this script (or be called immediately after it) to check group membership and trigger state transitions. Modifying this critical script carries regression risk.
- **Redis key namespace**: New keys for group state (`{prefix}:{queueName}:groups`, `{prefix}:{queueName}:groups:{groupId}`) must not collide with existing key patterns. The `obliterate` and `drain` scripts should be made aware of group keys for cleanup.
- **Compensation queue lifecycle**: The `{queueName}:compensation` queue is a regular BullMQ queue. It needs its own Worker to process compensation jobs. If no compensation Worker is running, compensation jobs accumulate silently. The PRD documents this but does not solve it (it's a deployment concern).
- **Race conditions**: Multiple workers may complete/fail different jobs in the same group concurrently. Group state transitions must be atomic via Lua scripts to prevent split-brain (e.g., one worker sees all jobs done while another is about to fail one).
- **Test runtime**: Tests require Redis running via `docker-compose up -d`. Group lifecycle tests involve multiple jobs processing sequentially, which adds test time. Individual test files should complete within 30 seconds.
- **Lua script compilation**: After adding new Lua scripts, `npm run pretest` must run to compile them. Tests will fail with NOSCRIPT errors if this step is skipped.

## Functional Requirements


### GRP-1: Group creation via FlowProducer


**Required behavior:**


The FlowProducer gains a new `addGroup()` method:


```typescript
const flowProducer = new FlowProducer({ connection });

const groupNode = await flowProducer.addGroup({
  name: 'order-fulfillment',
  jobs: [
    { name: 'charge-payment', queueName: 'payments', data: { orderId: '123', amount: 99.99 } },
    { name: 'reserve-inventory', queueName: 'inventory', data: { orderId: '123', sku: 'WIDGET-1', qty: 2 } },
    { name: 'send-confirmation', queueName: 'notifications', data: { orderId: '123', email: 'user@example.com' } },
  ],
  compensation: {
    'charge-payment': { name: 'refund-payment', data: { orderId: '123' } },
    'reserve-inventory': { name: 'release-inventory', data: { orderId: '123', sku: 'WIDGET-1', qty: 2 } },
    'send-confirmation': { name: 'send-cancellation', data: { orderId: '123', email: 'user@example.com' } },
  },
});
```


The method atomically (via Redis `MULTI`/`EXEC`):

1. Generates a unique group ID (UUID or auto-increment)
2. Creates a group metadata hash in Redis with state PENDING
3. Adds all jobs to their respective queues with group membership metadata in `opts`
4. Records the compensation mapping for each job
5. Transitions group state to ACTIVE

Each job in the group receives a `groupId` in its options, stored as job data accessible via `job.opts.group.id`.


**Acceptance criteria:**

- `addGroup()` returns a `GroupNode` containing the group ID and an array of created Job instances
- All jobs are added atomically (if Redis pipeline fails, no partial group exists)
- Each job's options contain `group: { id: groupId, name: groupName }`
- Group metadata is stored in Redis as a hash at `{prefix}:{queueName}:groups:{groupId}`
- Group initial state is ACTIVE after creation (PENDING is transient within the atomic operation)
- Jobs in the group can target different queue names
- Compensation mapping is stored alongside group metadata
- `addGroup()` with an empty `jobs` array returns an error
- Job names in `compensation` that don't match any job in `jobs` return an error

### GRP-2: Group state tracking


**Required behavior:**


Group state is tracked in a Redis hash with the following structure:


```text
Key: {prefix}:{queueName}:groups:{groupId}
Fields:
  name        - Group name (string)
  state       - Current state (string: PENDING|ACTIVE|COMPENSATING|COMPLETED|FAILED|FAILED_COMPENSATION)
  createdAt   - Creation timestamp (number)
  updatedAt   - Last state change timestamp (number)
  totalJobs   - Total number of jobs in group (number)
  completedCount - Number of completed jobs (number)
  failedCount - Number of failed jobs (number)
  cancelledCount - Number of cancelled jobs (number)
```


Individual job statuses within the group are tracked in a separate hash:


```text
Key: {prefix}:{queueName}:groups:{groupId}:jobs
Fields:
  {jobKey} - Status string: pending|active|completed|failed|cancelled
```


State transitions:

- **PENDING → ACTIVE**: On group creation (atomic with job insertion)
- **ACTIVE → COMPLETED**: When all jobs in the group reach `completed` state
- **ACTIVE → COMPENSATING**: When any job in the group reaches `failed` state after exhausting retries
- **COMPENSATING → FAILED**: When all compensation jobs complete (success or failure)
- **COMPENSATING → FAILED_COMPENSATION**: When a compensation job itself fails after exhausting retries
- **ACTIVE → FAILED**: When `cancelGroup()` is called (if no completed jobs need compensation)
- **ACTIVE → COMPENSATING**: When `cancelGroup()` is called and completed jobs exist

**Acceptance criteria:**

- Group state is stored in Redis (not in-memory) for multi-worker correctness
- State transitions are atomic via Lua scripts (no intermediate states visible to concurrent readers)
- `completedCount`, `failedCount`, and `cancelledCount` are updated atomically with state changes
- Invalid state transitions are rejected (e.g., COMPLETED → ACTIVE)
- Group metadata persists until explicitly cleaned up or the queue is obliterated

### GRP-3: Successful group completion


**Required behavior:**


When the last job in a group completes successfully:

1. The `moveToFinished` Lua script (or a post-completion hook) checks if the completed job belongs to a group
2. Increments the group's `completedCount`
3. If `completedCount` equals `totalJobs`, transitions group state to COMPLETED
4. Emits a `group:completed` event on the queue's event stream with `{ groupId, groupName }`

```typescript
const queueEvents = new QueueEvents('payments', { connection });
queueEvents.on('group:completed', ({ groupId, groupName }) => {
  console.log(`Group ${groupName} (${groupId}) completed successfully`);
});
```


**Acceptance criteria:**

- Group transitions to COMPLETED only when ALL member jobs are completed
- The `group:completed` event fires exactly once per successful group
- The event includes the group ID and group name
- Partial completion (some jobs done, others still processing) does not trigger the event
- Group completion works correctly when jobs are processed by different workers
- The completion check is atomic (no race between two workers completing the last two jobs simultaneously)

### GRP-4: Failed job triggers compensation


**Required behavior:**


When a job in a group fails after exhausting all retries (moves to the `failed` set):

1. The Lua script detects the job belongs to a group
2. Transitions the group state from ACTIVE to COMPENSATING
3. Cancels all remaining pending/waiting/delayed jobs in the group by removing them from their respective queues
4. For each already-completed job that has a compensation mapping, creates a compensation job in the `{queueName}:compensation` queue
5. Compensation jobs receive the original job's return value and the compensation data merged together
6. Emits a `group:compensating` event with `{ groupId, groupName, failedJobId, reason }`

Compensation job data structure:


```typescript
{
  groupId: string;
  originalJobName: string;
  originalJobId: string;
  originalReturnValue: any;
  compensationData: any;  // From the compensation mapping
}
```


**Acceptance criteria:**

- Group transitions to COMPENSATING when any member job fails after exhausting retries
- Pending/waiting/delayed group jobs are cancelled (removed from queues, marked cancelled in group)
- Active group jobs are allowed to finish (not forcibly terminated) but their results are ignored for group success
- Compensation jobs are created only for completed jobs that have compensation mappings
- Completed jobs without compensation mappings are skipped (no error)
- Compensation jobs include the original job's return value for context
- The `group:compensating` event fires with the failed job's ID and failure reason
- If the failing job has no siblings that completed (first job fails), no compensation jobs are created and group goes directly to FAILED
- Concurrent failures (two jobs fail at nearly the same time) result in exactly one compensation cycle

### GRP-5: Compensation job execution


**Required behavior:**


Compensation jobs are regular BullMQ jobs that run in a dedicated compensation queue:


```typescript
const compensationWorker = new Worker(
  'payments:compensation',
  async (job) => {
    const { groupId, originalJobName, originalReturnValue, compensationData } = job.data;
    // Execute compensation logic (e.g., refund payment)
    await refundPayment(compensationData.orderId);
  },
  { connection }
);
```


Compensation jobs have their own retry configuration. The default is 3 attempts with exponential backoff, but this is configurable in the group definition:


```typescript
await flowProducer.addGroup({
  name: 'order-fulfillment',
  jobs: [...],
  compensation: {
    'charge-payment': {
      name: 'refund-payment',
      data: { orderId: '123' },
      opts: { attempts: 5, backoff: { type: 'exponential', delay: 5000 } },
    },
  },
});
```


When all compensation jobs complete (regardless of their individual success/failure):

- If all compensation jobs succeeded: group state transitions to FAILED (compensation was successful, but the group itself failed)
- If any compensation job failed after exhausting retries: group state transitions to FAILED_COMPENSATION

**Acceptance criteria:**

- Compensation jobs are added to `{queueName}:compensation` queue
- Compensation jobs have independent retry logic from the original jobs
- Default retry is 3 attempts with exponential backoff (1000ms base)
- Custom retry options in the compensation mapping override defaults
- When all compensation jobs finish, group state transitions to FAILED or FAILED_COMPENSATION
- `group:failed` event fires with `{ groupId, groupName, compensationResults }` when the terminal state is reached
- Compensation jobs can be monitored via a standard `QueueEvents` instance on the compensation queue
- If no compensation Worker is running, compensation jobs sit in the waiting list (no silent loss)

### GRP-6: Group query API


**Required behavior:**


The Queue class gains methods for inspecting group state:


```typescript
const queue = new Queue('payments', { connection });

// Get group state
const state = await queue.getGroupState(groupId);
// Returns: { id, name, state, createdAt, updatedAt, totalJobs, completedCount, failedCount, cancelledCount }

// Get all jobs in a group with their statuses
const groupJobs = await queue.getGroupJobs(groupId);
// Returns: [{ jobId, jobKey, status, queueName }]

// Cancel a group (triggers compensation if needed)
await queue.cancelGroup(groupId);
```


**Acceptance criteria:**

- `getGroupState()` returns the current group metadata from Redis
- `getGroupState()` for a non-existent group ID returns `null`
- `getGroupJobs()` returns all member jobs with their current status within the group
- `getGroupJobs()` includes jobs from different queues (cross-queue group visibility)
- `cancelGroup()` on an ACTIVE group cancels pending jobs and triggers compensation for completed jobs
- `cancelGroup()` on a COMPLETED group returns an error (cannot cancel a completed group)
- `cancelGroup()` on an already COMPENSATING/FAILED group returns an error
- All query methods work correctly with concurrent job processing

### GRP-7: Group events on QueueEvents


**Required behavior:**


The QueueEvents stream emits group lifecycle events:


|        Event         |                    Payload                    |                                 When                                 |
| -------------------- | --------------------------------------------- | -------------------------------------------------------------------- |
| `group:completed`    | `{ groupId, groupName }`                      | All jobs in group completed successfully                             |
| `group:compensating` | `{ groupId, groupName, failedJobId, reason }` | A job failed, compensation started                                   |
| `group:failed`       | `{ groupId, groupName, state }`               | Group reached terminal failure state (FAILED or FAILED_COMPENSATION) |


Events are published to the queue's Redis event stream (`{prefix}:{queueName}:events`) and picked up by `QueueEvents.on()`.


**Acceptance criteria:**

- All three event types are emitted at the correct state transitions
- Events contain the documented payload fields
- Events are visible via `QueueEvents` on the queue that owns the group
- Per-group event listeners work: `queueEvents.on('group:completed', cb)` fires for any group; filtering by `groupId` is the consumer's responsibility
- Events are not duplicated (each transition emits exactly one event)
- Events are ordered: `group:compensating` always precedes `group:failed` for a failed group

### GRP-8: Group membership constraints


**Required behavior:**

- A job can belong to at most one group. Attempting to add a job to a group when it already has `opts.group` set returns an error.
- Groups work with any job type: standard, delayed, prioritized. The group tracks the job regardless of which queue set it's in.
- Jobs added with `delay` are still group members. If the group enters COMPENSATING before a delayed job executes, the delayed job is cancelled.
- Prioritized jobs within a group are processed according to their priority (group membership doesn't affect scheduling).
- Group jobs cannot be flow children (flows and groups are separate coordination mechanisms). Attempting to add a job with both `opts.group` and `opts.parent` returns an error.

**Acceptance criteria:**

- Adding a job with an existing `opts.group` to another group throws an error
- Delayed jobs in a group are cancelled from the delayed set during compensation
- Prioritized jobs are cancelled from the prioritized set during compensation
- A job with both `opts.parent` and `opts.group` throws a validation error at `addGroup()` time
- Group state correctly reflects delayed and prioritized job completions/failures

## Technical Solution


### Architecture & Components


**New files:**


```text
src/
├── classes/
│   ├── job-group.ts            # JobGroup class (group metadata, state queries)
│   └── errors/
│       └── group-error.ts      # GroupNotFoundError, InvalidGroupStateError
├── commands/
│   ├── createGroup-4.lua       # Atomic group creation with job insertion
│   ├── updateGroupOnFinished-3.lua  # Post-completion/failure group state check
│   ├── cancelGroupJobs-3.lua   # Cancel pending jobs, prepare compensation
│   ├── triggerCompensation-3.lua    # Enqueue compensation jobs atomically
│   ├── getGroupState-1.lua     # Read group metadata
│   └── updateGroupCompensation-2.lua  # Track compensation completion
├── interfaces/
│   ├── group-job.ts            # GroupJobDefinition, CompensationMapping interfaces
│   └── group-options.ts        # GroupOptions, GroupState types
└── types/
    └── group-state.ts          # GroupState union type
```


**Modified files:**


```text
src/
├── classes/
│   ├── flow-producer.ts        # Add addGroup() method
│   ├── queue.ts                # Add getGroupState(), getGroupJobs(), cancelGroup()
│   └── scripts.ts              # Add methods for new Lua scripts
├── interfaces/
│   └── base-job-options.ts     # Add optional group field to JobsOptions
└── types/
    └── job-options.ts          # Include group in CompressableJobOptions
```


### Redis data structures


**Group metadata hash:**


```text
Key: {prefix}:{queueName}:groups:{groupId}
Type: HASH
Fields:
  name: string
  state: "PENDING" | "ACTIVE" | "COMPENSATING" | "COMPLETED" | "FAILED" | "FAILED_COMPENSATION"
  createdAt: number (epoch ms)
  updatedAt: number (epoch ms)
  totalJobs: number
  completedCount: number
  failedCount: number
  cancelledCount: number
  compensation: string (JSON-encoded compensation mapping)
```


**Group job membership:**


```text
Key: {prefix}:{queueName}:groups:{groupId}:jobs
Type: HASH
Fields:
  {jobKey}: "pending" | "active" | "completed" | "failed" | "cancelled"
```


**Group index (for listing groups):**


```text
Key: {prefix}:{queueName}:groups
Type: ZSET
Score: creation timestamp
Member: groupId
```


### Lua script design


**`createGroup-4.lua`:**

- KEYS: group hash key, group jobs key, groups index key, event stream key
- ARGV: group ID, group name, timestamp, total jobs, compensation JSON, job keys array
- Operations: HSET group metadata, ZADD to groups index, HSET each job status as "pending"
- This script runs inside the same MULTI/EXEC as the job additions

**`updateGroupOnFinished-3.lua`:**

- KEYS: group hash key, group jobs key, event stream key
- ARGV: job key, new status (completed|failed), timestamp, return value (if completed)
- Operations:
1. HSET job status in group jobs
2. HINCRBY completedCount or failedCount on group hash
3. If status is "completed" and completedCount == totalJobs: set state to COMPLETED, XADD group:completed event
4. If status is "failed": set state to COMPENSATING, XADD group:compensating event, return list of completed jobs for compensation
- Returns: state transition info (for the caller to enqueue compensation jobs if needed)

**`cancelGroupJobs-3.lua`:**

- KEYS: group hash key, group jobs key, event stream key
- ARGV: timestamp, group ID
- Operations: iterate group jobs, remove pending/waiting/delayed jobs from their queue sets, mark as cancelled, update counts

**`triggerCompensation-3.lua`:**

- KEYS: compensation queue keys (wait, meta, event stream)
- ARGV: compensation job data array
- Operations: add compensation jobs to the compensation queue, similar to addStandardJob

**`updateGroupCompensation-2.lua`:**

- KEYS: group hash key, event stream key
- ARGV: compensation job key, success/failure, timestamp
- Operations: track compensation completion, transition to FAILED or FAILED_COMPENSATION when all compensations done

### Integration with `moveToFinished`


The group check should happen after `moveToFinished` completes, not inside it. This avoids modifying the complex 14-key `moveToFinished` script. Instead:

1. `moveToFinished` runs as normal (moves job to completed/failed set)
2. The Worker's post-processing code checks if the job has `opts.group`
3. If yes, calls `updateGroupOnFinished` Lua script with the job's final state
4. If the script returns a compensation trigger, the Worker calls `triggerCompensation`

This two-step approach is safe because:

- The job is already in its final state (completed/failed) before the group check
- If the Worker crashes between steps 1 and 2, the group state is stale but recoverable (a separate consistency check can detect this)
- The group state transitions are individually atomic (each Lua script is atomic)

### Compensation queue convention


Compensation queues follow the naming convention `{originalQueueName}:compensation`. For a group spanning multiple queues, compensation jobs for each original queue go to that queue's compensation queue:

- Job in `payments` queue → compensation in `payments:compensation`
- Job in `inventory` queue → compensation in `inventory:compensation`

This allows teams to deploy queue-specific compensation workers.


### Testing approach


Tests use Vitest with Redis integration (matching existing test infrastructure):


```typescript
import { FlowProducer, Queue, Worker, QueueEvents } from '../src/classes';

describe('JobGroup', () => {
  let flowProducer: FlowProducer;
  let queue: Queue;
  let worker: Worker;
  let queueEvents: QueueEvents;

  beforeEach(async () => {
    // Setup with fresh Redis state
  });

  afterEach(async () => {
    await worker.close();
    await flowProducer.close();
    await queue.close();
    await queueEvents.close();
  });
});
```


Test files:

- `tests/test_group_creation.ts` -- group creation, validation, atomic insertion
- `tests/test_group_completion.ts` -- successful group lifecycle
- `tests/test_group_compensation.ts` -- failure + compensation flow
- `tests/test_group_cancel.ts` -- manual cancellation
- `tests/test_group_query.ts` -- state and job queries
- `tests/test_group_edge_cases.ts` -- concurrent failures, delayed jobs, prioritized jobs, mixed queues

### Dependency changes


No new npm dependencies. All functionality uses existing Redis commands (HSET, HGET, HINCRBY, ZADD, XADD) called from Lua scripts.


## Validation Contract


### VAL-01: Create a job group (happy path)


```gherkin
GIVEN a FlowProducer connected to Redis
WHEN I call addGroup with name "order-123", 3 jobs targeting different queues, and a compensation mapping
THEN a GroupNode is returned with a generated groupId and 3 Job instances
AND the group metadata hash exists in Redis with state "ACTIVE" and totalJobs 3
AND each job's options contain group.id matching the groupId
AND the compensation mapping is stored in the group metadata
```


### VAL-02: Create a group with empty jobs array (negative path)


```gherkin
GIVEN a FlowProducer connected to Redis
WHEN I call addGroup with an empty jobs array
THEN an error is thrown indicating that a group must contain at least one job
AND no group metadata is created in Redis
```


### VAL-03: Create a group with mismatched compensation keys (negative path)


```gherkin
GIVEN a FlowProducer connected to Redis
WHEN I call addGroup with a compensation mapping that references a job name not in the jobs array
THEN an error is thrown indicating the unmatched compensation key
AND no group or jobs are created in Redis
```


### VAL-04: Group completes when all jobs succeed


```gherkin
GIVEN a group with 3 jobs and workers processing each queue
WHEN all 3 jobs complete successfully
THEN the group state transitions to "COMPLETED"
AND the group's completedCount is 3
AND a "group:completed" event is emitted on QueueEvents with the groupId and groupName
```


### VAL-05: Group completes with concurrent workers


```gherkin
GIVEN a group with 3 jobs processed by 3 separate Worker instances
WHEN all 3 jobs complete at roughly the same time
THEN the group state is "COMPLETED" (not stuck in ACTIVE)
AND exactly one "group:completed" event is emitted (no duplicates)
```


### VAL-06: Failed job triggers compensation for completed siblings


```gherkin
GIVEN a group with 3 jobs: job-A, job-B, job-C with compensation mappings for all three
AND job-A and job-B have already completed
WHEN job-C fails after exhausting retries (attempts: 2)
THEN the group state transitions to "COMPENSATING"
AND compensation jobs are created for job-A and job-B in their respective compensation queues
AND compensation job data includes originalJobId, originalReturnValue, and compensationData
AND a "group:compensating" event is emitted with failedJobId = job-C's ID
```


### VAL-07: No compensation when first job fails with no completed siblings


```gherkin
GIVEN a group with 3 jobs, none yet processed
WHEN the first job to be processed fails after exhausting retries
THEN remaining pending jobs are cancelled
AND no compensation jobs are created (no completed jobs to compensate)
AND the group transitions to "FAILED"
AND a "group:failed" event is emitted
```


### VAL-08: Compensation jobs execute with retry


```gherkin
GIVEN a group in COMPENSATING state with 2 compensation jobs queued
AND a compensation worker is processing the compensation queue
WHEN the first compensation job fails once then succeeds on retry
AND the second compensation job succeeds on first attempt
THEN the group transitions to "FAILED" (compensation succeeded, group still failed)
AND a "group:failed" event is emitted with state "FAILED"
```


### VAL-09: Failed compensation transitions to FAILED_COMPENSATION


```gherkin
GIVEN a group in COMPENSATING state with 1 compensation job queued
AND the compensation job is configured with attempts: 2
WHEN the compensation job fails on both attempts
THEN the group transitions to "FAILED_COMPENSATION"
AND a "group:failed" event is emitted with state "FAILED_COMPENSATION"
```


### VAL-10: Cancel an active group with completed jobs


```gherkin
GIVEN a group with 3 jobs where job-A is completed, job-B is waiting, and job-C is delayed
WHEN I call queue.cancelGroup(groupId)
THEN job-B is removed from the waiting list
AND job-C is removed from the delayed set
AND a compensation job is created for job-A
AND the group state transitions to "COMPENSATING"
```


### VAL-11: Cancel an active group with no completed jobs


```gherkin
GIVEN a group with 3 jobs, all still in waiting state
WHEN I call queue.cancelGroup(groupId)
THEN all 3 jobs are removed from waiting
AND the group state transitions to "FAILED" (no compensation needed)
AND no compensation jobs are created
```


### VAL-12: Cancel a completed group (negative path)


```gherkin
GIVEN a group in "COMPLETED" state
WHEN I call queue.cancelGroup(groupId)
THEN an error is thrown indicating the group cannot be cancelled (already completed)
AND the group state remains "COMPLETED"
```


### VAL-13: Query group state


```gherkin
GIVEN a group with 3 jobs where 2 have completed and 1 is still active
WHEN I call queue.getGroupState(groupId)
THEN the result contains state "ACTIVE", totalJobs 3, completedCount 2, failedCount 0, cancelledCount 0
AND name, createdAt, and updatedAt are present
```


### VAL-14: Query group state for non-existent group


```gherkin
GIVEN no group with ID "nonexistent"
WHEN I call queue.getGroupState("nonexistent")
THEN the result is null
```


### VAL-15: Query group jobs


```gherkin
GIVEN a group with 3 jobs (1 completed, 1 active, 1 pending)
WHEN I call queue.getGroupJobs(groupId)
THEN the result is an array of 3 entries
AND each entry contains jobId, jobKey, status, and queueName
AND statuses match: "completed", "active", "pending"
```


### VAL-16: Delayed jobs in a group are cancelled during compensation


```gherkin
GIVEN a group with job-A (standard) and job-B (delay: 60000)
AND job-A fails after exhausting retries
WHEN compensation is triggered
THEN job-B is removed from the delayed sorted set
AND job-B's status in the group is "cancelled"
AND the group's cancelledCount is 1
```


### VAL-17: Prioritized jobs in a group are cancelled during compensation


```gherkin
GIVEN a group with job-A (standard) and job-B (priority: 5)
AND job-A fails after exhausting retries
WHEN compensation is triggered
THEN job-B is removed from the prioritized sorted set
AND job-B's status in the group is "cancelled"
```


### VAL-18: Job cannot belong to both a group and a flow


```gherkin
GIVEN a FlowProducer
WHEN I call addGroup with a job that has opts.parent set
THEN an error is thrown indicating a job cannot belong to both a group and a flow
AND no group or jobs are created
```


### VAL-19: Compensation jobs include original return value


```gherkin
GIVEN a group where job-A completed with returnvalue { transactionId: "tx-456" }
AND job-A has a compensation mapping
WHEN job-B fails and compensation is triggered
THEN the compensation job for job-A has data.originalReturnValue = { transactionId: "tx-456" }
```


### VAL-20: Active jobs are not forcibly terminated during compensation


```gherkin
GIVEN a group with job-A (completed), job-B (active/processing), and job-C (failed, triggered compensation)
WHEN compensation begins
THEN job-B continues processing to completion (not killed)
AND job-B's result is ignored for group success (group is already COMPENSATING)
AND if job-B completes, its status in the group updates but does not change the group state
```


### VAL-21: No regressions in existing test suite


```gherkin
GIVEN all new group-related files are added
WHEN I run npm test with Redis running
THEN all existing BullMQ tests pass (no regressions)
AND npm run tsc:all compiles without errors
AND npm run lint reports no new violations
```


---

# Technical Context
# Technical Context: Transactional Job Groups with Saga Compensation

## Verified Tech Stack

**From `package.json` (dependencies section):**
- Language: TypeScript 5.9.3 (devDependencies: `typescript: 5.9.3`)
- Runtime target: Node.js (types: `@types/node: 18.19.130`)
- Package Manager: Yarn 1.22.22 (`packageManager` field)
- Queue/Redis client: ioredis 5.9.3
- UUID generation: uuid 11.1.0 (already used in `flow-producer.ts` and `queue.ts` via `import { v4 } from 'uuid'`)
- Serialization: msgpackr 1.11.5 (used in `scripts.ts` via `Packr`)
- Test framework: Vitest 4.0.18 (`vitest: 4.0.18` in devDependencies)
- Build: TypeScript compiler (`tsc:all` runs `tsc && tsc -p tsconfig-cjs.json`)
- Lua script pipeline: custom `commandTransform.js` script (see `pretest` script in package.json)

**No new npm dependencies required.** All group functionality uses existing Redis commands (HSET, HINCRBY, ZADD, XADD, ZREM, LREM) callable from Lua scripts, following the existing pattern.

---

## Relevant Files & Patterns

### Files to Create (New)

- `src/classes/job-group.ts` — New `JobGroup` class; model after `src/classes/job-scheduler.ts` which similarly encapsulates Redis-backed metadata with a dedicated class
- `src/classes/errors/group-error.ts` — New error classes; follow the pattern in `src/classes/errors/unrecoverable-error.ts` (extends `Error`, sets `this.name = this.constructor.name`, uses `Object.setPrototypeOf(this, new.target.prototype)`)
- `src/interfaces/group-job.ts` — `GroupJobDefinition` and `CompensationMapping` interfaces; follow the pattern of `src/interfaces/flow-job.ts`
- `src/interfaces/group-options.ts` — `GroupOptions`, `GroupState` type; follow `src/interfaces/parent-options.ts` for style
- `src/types/group-state.ts` — `GroupState` union type; follow `src/types/finished-status.ts` style
- `src/commands/createGroup-4.lua` — Lua script for atomic group creation
- `src/commands/updateGroupOnFinished-3.lua` — Post-finish group state check
- `src/commands/cancelGroupJobs-3.lua` — Cancel pending group jobs during compensation
- `src/commands/triggerCompensation-3.lua` — Enqueue compensation jobs atomically
- `src/commands/getGroupState-1.lua` — Read group metadata
- `src/commands/updateGroupCompensation-2.lua` — Track compensation completion

### Files to Modify

- `src/classes/flow-producer.ts` — Add `addGroup()` method; pattern to follow is the existing `add()` method (lines 192–231) which uses `client.multi()` → `addNode()` → `multi.exec()`
- `src/classes/queue.ts` — Add `getGroupState()`, `getGroupJobs()`, `cancelGroup()` methods; follow the existing getter pattern in `src/classes/queue-getters.ts`
- `src/classes/scripts.ts` — Add methods for new Lua scripts; follow the `execCommand()` pattern used throughout (e.g., `moveToFinished`, `promote`, `addStandardJob`)
- `src/classes/queue-keys.ts` — Add group key helpers (`groups`, `groups:{groupId}`, `groups:{groupId}:jobs`); follow the existing `getKeys()` and `toKey()` pattern
- `src/interfaces/base-job-options.ts` — Add optional `group?: { id: string; name: string }` field to `BaseJobOptions`; already has `parent?: ParentOptions` as precedent
- `src/types/job-options.ts` — Add `group` to `CompressableJobOptions` (and its compressed alias to `RedisJobOptions`); follow existing `telemetry`/`tm` pattern for naming compressed keys
- `src/classes/errors/index.ts` — Export new group error classes
- `src/commands/obliterate-2.lua` — Add group key cleanup; the obliterate script currently deletes all `baseKey:*` keys via pattern scanning — group keys under `{prefix}:{queueName}:groups` must be included

### Existing Patterns to Follow

**Lua script naming convention:** `{scriptName}-{numKeys}.lua` where `{numKeys}` is the count of KEYS[] arguments. E.g., `addStandardJob-9.lua` uses 9 KEYS. New scripts must follow this pattern exactly because the `commandTransform.js` build step uses the number suffix to generate the loader.

**Lua script include mechanism:** New Lua scripts can use `--- @include "includes/someHelper.lua"` to include shared helpers. Existing helpers are in `src/commands/includes/` (e.g., `addJobInTargetList.lua`, `addJobWithPriority.lua`). Inspect `src/commands/addStandardJob-9.lua` for reference.

**Script registration in `scripts.ts`:** Each Lua command is invoked via `this.execCommand(client, 'scriptName', [KEYS..., ARGV...])`. The raw script name (without `-N` suffix) is used as the command name. New Lua scripts must be registered via the same `execCommand` pattern in new typed wrapper methods inside `Scripts`.

**`moveToFinished` post-hook integration:** The group check must NOT modify `moveToFinished-14.lua` directly. Instead, call `updateGroupOnFinished` from the Worker's post-processing code after `moveToFinished` completes. In `src/classes/worker.ts`, look for where `scripts.moveToFinished(...)` is awaited — the group hook should be added there, conditionally checking `job.opts.group?.id`.

**`FlowProducer.add()` atomic pipeline pattern (from `src/classes/flow-producer.ts`, `add()` method):**
```typescript
const client = await this.connection.client;
const multi = client.multi();           // ChainableCommander
// ... enqueue operations on multi ...
await multi.exec();
return result;
```
`addGroup()` must follow this same pattern. The Lua script `createGroup-4.lua` will be called on the `multi` pipeline (not as a standalone command), matching how `addNode()` uses `multi` for atomic job insertion.

**Error class pattern (from `src/classes/errors/unrecoverable-error.ts`):**
```typescript
export class GroupNotFoundError extends Error {
  constructor(groupId: string) {
    super(`Group ${groupId} not found`);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
```

**Event emission via Redis Stream (from `src/classes/queue-events-producer.ts`, `publishEvent()`):**
```typescript
// XADD via Lua: XADD {prefix}:{queueName}:events MAXLEN ~ 10000 * event group:completed groupId <id> groupName <name>
```
Group events (`group:completed`, `group:compensating`, `group:failed`) should be written to the queue's existing events stream key (`this.queue.keys.events`) using `XADD` inside the Lua scripts, matching how existing events like `completed` and `failed` are emitted in `moveToFinished-14.lua`.

**QueueEvents listener extension (from `src/classes/queue-events.ts`, `QueueEventsListener` interface):** New group event types must be added to the `QueueEventsListener` interface in `queue-events.ts` following the existing typed event listener pattern (e.g., `completed`, `failed` events).

**UUID generation:** `import { v4 } from 'uuid'` — already available, already used in `flow-producer.ts` and `queue.ts`.

**msgpackr for ARGV serialization (from `src/classes/scripts.ts`, top of file):**
```typescript
const packer = new Packr({ useRecords: false, encodeUndefinedAsNil: true });
const pack = packer.pack;
```
When passing complex ARGV arrays to Lua scripts (arrays, objects), use `pack(data)` for serialization, matching the pattern in `addStandardJob`, `addDelayedJob`, etc.

---

## Integration Points

**`src/classes/worker.ts` — Post-finish hook:**
The Worker is the primary integration point. After `this.scripts.moveToFinished(...)` completes for a group member job, a new code path must call `this.scripts.updateGroupOnFinished(...)`. The Lua script returns a signal indicating whether compensation must be triggered; if so, Worker calls `this.scripts.triggerCompensation(...)`. This two-step approach is safe because `moveToFinished` atomically moves the job to its final set before the group check runs.

**`src/classes/flow-producer.ts` — `addGroup()` method:**
New method on `FlowProducer`. Uses the existing `client.multi()` pipeline and `this.queueKeys` for key construction. Must call `createGroup-4.lua` on the pipeline along with `addStandardJob`/`addDelayedJob`/`addPrioritizedJob` calls (one per group job). Jobs in the group can target different queues, so `QueueKeys.toKey()` must be called with each job's `queueName`.

**`src/classes/queue.ts` — Query API:**
Three new methods: `getGroupState(groupId)`, `getGroupJobs(groupId)`, `cancelGroup(groupId)`. These delegate to new `Scripts` methods which call the respective Lua scripts. `cancelGroup()` must also invoke `cancelGroupJobs-3.lua` and then `triggerCompensation-3.lua` if completed jobs exist.

**`src/classes/queue-events.ts` — Group event listener interface:**
`QueueEventsListener` must be extended with `'group:completed'`, `'group:compensating'`, and `'group:failed'` event signatures. The `QueueEvents` class reads from the Redis event stream and dispatches to listeners — group events are already emitted to the stream by Lua scripts, so no change to the stream-reading loop is needed; only the interface declarations and the event-name-to-handler dispatching logic need updating.

**`src/commands/obliterate-2.lua` — Cleanup:**
The obliterate script must be made aware of group keys so they are deleted when a queue is obliterated. The current script uses pattern-based key deletion on `baseKey:*`. Group keys follow the pattern `{prefix}:{queueName}:groups` and `{prefix}:{queueName}:groups:*`, which already fall within the `baseKey:*` pattern if `baseKey = {prefix}:{queueName}`. Verify this and add explicit ZSET and HASH deletion if pattern scanning misses them.

**`src/commands/drain-5.lua` — Drain awareness:**
Similarly, verify group keys are cleaned during drain. Group metadata hashes and the groups index ZSET should be cleared.

**Compensation queue as standard BullMQ queue:**
The `{queueName}:compensation` queue is a regular queue (no code changes to `Queue` or `Worker` classes needed). The `triggerCompensation-3.lua` script adds jobs to it using the same `addStandardJob` Redis key pattern (wait list, meta, id counter, events stream). Workers for compensation queues are user-managed. BullMQ's `updateGroupCompensation-2.lua` is invoked from the compensation Worker's post-finish hook to track overall compensation completion and transition the group to `FAILED` or `FAILED_COMPENSATION`.

**Impact boundary:**
- All changes are internal to the BullMQ Node.js package.
- No changes to Python, Elixir, or PHP implementations.
- No changes to existing Lua scripts except `obliterate-2.lua` and `drain-5.lua` (group key cleanup) and potentially `moveToFinished-14.lua` (only if a hook point cannot be placed in the Worker's TypeScript layer — PRD strongly prefers NOT modifying this script).
- External API contracts (existing `Queue`, `Worker`, `FlowProducer`, `QueueEvents` public APIs) remain unchanged; new methods are additive only.

---

## Data Persistence

### New Redis Keys

**Group metadata hash:**
```
Key:    {prefix}:{queueName}:groups:{groupId}
Type:   HASH
Fields:
  name           string         Group name
  state          string         PENDING|ACTIVE|COMPENSATING|COMPLETED|FAILED|FAILED_COMPENSATION
  createdAt      number         epoch ms
  updatedAt      number         epoch ms
  totalJobs      number         Total jobs in group
  completedCount number         Jobs completed successfully
  failedCount    number         Jobs failed after exhausting retries
  cancelledCount number         Jobs cancelled during compensation
  compensation   string         JSON-encoded CompensationMapping
```

**Group job membership hash:**
```
Key:    {prefix}:{queueName}:groups:{groupId}:jobs
Type:   HASH
Fields:
  {jobKey}  string   pending|active|completed|failed|cancelled
```
`jobKey` format: `{prefix}:{jobQueueName}:{jobId}` — the fully-qualified job key, enabling cross-queue membership tracking.

**Group index sorted set:**
```
Key:    {prefix}:{queueName}:groups
Type:   ZSET
Score:  createdAt (epoch ms)
Member: groupId
```

### Modified Job Options (in-memory and Redis)

`BaseJobOptions` gains an optional `group?: { id: string; name: string }` field. In `CompressableJobOptions` / `RedisJobOptions`, the compressed key should be `grp` (following the existing abbreviation convention: `fpof`, `cpof`, `idof`, `rdof`, `tm`, `omc`, `de`).

### No Database Migrations

BullMQ uses schemaless Redis structures; no migration tooling is used. New keys are created on demand. Obliterate/drain scripts handle cleanup.

---

## API Definitions

### `FlowProducer.addGroup(options: GroupOptions): Promise<GroupNode>`

```typescript
interface GroupJobDefinition {
  name: string;
  queueName: string;
  data: any;
  opts?: JobsOptions;  // Must not contain opts.parent (throws validation error)
}

interface CompensationJobDefinition {
  name: string;
  data: any;
  opts?: Pick<JobsOptions, 'attempts' | 'backoff'>;  // Default: attempts 3, exponential 1000ms
}

interface GroupOptions {
  name: string;
  jobs: GroupJobDefinition[];               // Must be non-empty
  compensation?: Record<string, CompensationJobDefinition>;  // Keys must match job names in jobs[]
}

interface GroupNode {
  groupId: string;
  groupName: string;
  jobs: Job[];
}
```

Errors thrown:
- Empty `jobs` array → `Error('Group must contain at least one job')`
- `compensation` key not matching any job name → `Error('Compensation key "${key}" does not match any job name')`
- Any job with `opts.parent` set → `Error('A job cannot belong to both a group and a flow')`

### `Queue.getGroupState(groupId: string): Promise<GroupState | null>`

Returns `null` for non-existent group IDs. Returns a `GroupState` object:
```typescript
interface GroupState {
  id: string;
  name: string;
  state: 'ACTIVE' | 'COMPENSATING' | 'COMPLETED' | 'FAILED' | 'FAILED_COMPENSATION';
  createdAt: number;
  updatedAt: number;
  totalJobs: number;
  completedCount: number;
  failedCount: number;
  cancelledCount: number;
}
```

### `Queue.getGroupJobs(groupId: string): Promise<GroupJobEntry[]>`

```typescript
interface GroupJobEntry {
  jobId: string;
  jobKey: string;   // Fully-qualified key: {prefix}:{queueName}:{jobId}
  status: 'pending' | 'active' | 'completed' | 'failed' | 'cancelled';
  queueName: string;
}
```

### `Queue.cancelGroup(groupId: string): Promise<void>`

Errors thrown:
- Group is COMPLETED → `InvalidGroupStateError('Cannot cancel a completed group')`
- Group is COMPENSATING or FAILED or FAILED_COMPENSATION → `InvalidGroupStateError('Cannot cancel group in state ${state}')`

### `QueueEventsListener` Extensions

```typescript
'group:completed': (args: { groupId: string; groupName: string }, id: string) => void;
'group:compensating': (args: { groupId: string; groupName: string; failedJobId: string; reason: string }, id: string) => void;
'group:failed': (args: { groupId: string; groupName: string; state: 'FAILED' | 'FAILED_COMPENSATION' }, id: string) => void;
```

---

## Technical Constraints

### Lua Script Build Pipeline (CRITICAL)

**Must run `yarn pretest` (or `npm run pretest`) after adding any new Lua script.** The pretest sequence is:
```
clean:scripts → generate:raw:scripts → transform:commands → circular:references
```
`transform:commands` runs `node ./scripts/commandTransform.js ./rawScripts ./src/scripts` which compiles Lua scripts (with includes resolved) into the format expected by ioredis. Tests will fail with `NOSCRIPT` errors if this step is skipped. The `-{N}` suffix in the Lua filename must exactly match the number of KEYS[] arguments.

### Atomic State Transitions

All group state changes must be implemented inside Lua scripts to guarantee atomicity. Redis executes Lua scripts as a single atomic operation. Node.js-level reads followed by writes are not acceptable for state transitions — any such pattern introduces TOCTOU race conditions with concurrent workers.

### Key Namespace Collision Avoidance

Existing `QueueKeys.getKeys()` (in `src/classes/queue-keys.ts`) defines the key suffixes for standard queue sets. Group keys use the suffix `groups` and `groups:{groupId}` and `groups:{groupId}:jobs`. Verify these suffixes are not already used. They currently do not appear in `getKeys()`.

### Worker Post-Processing Hook Placement

The group hook in `worker.ts` must handle two failure modes:
1. Worker crash between `moveToFinished` completing and `updateGroupOnFinished` being called → group state will be stale. This is documented as acceptable (recoverable with a consistency check outside this PRD).
2. Concurrent workers completing the last two jobs simultaneously → `updateGroupOnFinished` Lua script must handle idempotency: if the group is already COMPLETED or COMPENSATING, the script should be a no-op.

### TypeScript Compilation

Run `yarn tsc:all` to validate both ESM and CJS compilation targets. New interfaces must be exported from `src/interfaces/index.ts` and new types from `src/types/index.ts`. New classes must be exported from `src/classes/index.ts`.

---

## Testing Strategy

### Test File Structure (follow `tests/flow.test.ts` pattern)

```typescript
import { default as IORedis } from 'ioredis';
import { describe, beforeEach, afterEach, beforeAll, afterAll, it, expect } from 'vitest';
import { v4 } from 'uuid';
import { FlowProducer, Queue, Worker, QueueEvents } from '../src/classes';
import { removeAllQueueData, delay } from '../src/utils';

describe('JobGroup', () => {
  const redisHost = process.env.REDIS_HOST || 'localhost';
  const prefix = process.env.BULLMQ_TEST_PREFIX || 'bull';

  let connection: IORedis;
  let queue: Queue;
  let queueName: string;

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
  });

  afterAll(async () => {
    await connection.quit();
  });
});
```

### Test Files and Scenarios

**`tests/test_group_creation.ts`** (VAL-01, VAL-02, VAL-03, VAL-18)
1. Happy path: `addGroup()` returns `GroupNode` with `groupId` and 3 `Job` instances; Redis hash exists with state `ACTIVE` and `totalJobs = 3`
2. Empty jobs array throws immediately without creating Redis keys
3. Mismatched compensation key throws; no Redis keys created (verify atomicity)
4. Job with `opts.parent` set throws validation error before any Redis operation
5. All jobs carry `opts.group.id` matching the returned `groupId`

**`tests/test_group_completion.ts`** (VAL-04, VAL-05, VAL-13, VAL-14, VAL-15)
1. Three jobs complete sequentially → group transitions to `COMPLETED`, `completedCount = 3`, `group:completed` fires exactly once
2. Three workers complete concurrently → group transitions to `COMPLETED`, `group:completed` fires exactly once (no duplicates)
3. `getGroupState()` reflects partial completion: `completedCount = 2`, state `ACTIVE`
4. `getGroupState('nonexistent')` returns `null`
5. `getGroupJobs()` returns correct statuses for pending/active/completed entries

**`tests/test_group_compensation.ts`** (VAL-06, VAL-07, VAL-08, VAL-09, VAL-19, VAL-20)
1. Two jobs completed, one fails after retries → group transitions to `COMPENSATING`; compensation jobs created for completed siblings with `originalReturnValue` populated
2. First job fails with no completed siblings → group transitions directly to `FAILED`; no compensation jobs
3. Compensation jobs succeed → group transitions to `FAILED`; `group:failed` emitted with `state: 'FAILED'`
4. Compensation job fails all attempts → group transitions to `FAILED_COMPENSATION`; `group:failed` emitted with `state: 'FAILED_COMPENSATION'`
5. Active job continues processing after compensation starts (not forcibly killed); its result does not change group state from `COMPENSATING`
6. Original return value present in compensation job data: `job.data.originalReturnValue` matches what original job returned

**`tests/test_group_cancel.ts`** (VAL-10, VAL-11, VAL-12)
1. Cancel active group with completed + waiting + delayed jobs → waiting and delayed jobs removed; compensation job created for completed job; state = `COMPENSATING`
2. Cancel active group with all jobs still waiting → all removed from wait; no compensation jobs; state = `FAILED`
3. Cancel completed group → `InvalidGroupStateError` thrown; state remains `COMPLETED`

**`tests/test_group_edge_cases.ts`** (VAL-16, VAL-17, VAL-05 concurrent variant)
1. Delayed job in group is removed from delayed sorted set during compensation; `cancelledCount = 1` in group hash
2. Prioritized job in group is removed from prioritized sorted set during compensation
3. Two jobs fail concurrently → exactly one compensation cycle initiated (atomic Lua transition prevents double-trigger)

### Test Infrastructure Notes

- Use `delay(ms)` from `src/utils` (already imported in existing test files) to wait for async job processing
- Use `QueueEvents` with `once('group:completed', ...)` wrapped in a Promise to assert events (follow the pattern in `tests/flow.test.ts` where `queueEvents.once('completed', ...)` is used)
- Cleanup: call `removeAllQueueData()` in `afterEach`, which deletes all queue keys by pattern — group keys under `{prefix}:{queueName}:groups*` should be covered if `removeAllQueueData` uses `DEL {prefix}:{queueName}:*`; verify this covers group keys
- Tests run sequentially (`--no-file-parallelism` in Vitest config); no parallel test concerns
- Redis must be running (`docker-compose up -d`) before running tests
