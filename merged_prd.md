# Product Requirements Document (PRD)
**Repository**: `https://github.com/dbenedetti-trimble/ada-nodejs-test-bullmq`

---


# Configurable Backoff Strategies and Circuit Breaker


## Context & Problem


### Problem statement

- **Who is affected?** Developers using BullMQ to process jobs against unreliable or rate-limited external services who need more control over retry timing and failure isolation.
- **What is the issue?** BullMQ provides only two built-in backoff strategies (`fixed` and `exponential`) and has no circuit breaker mechanism. When a downstream service degrades, workers keep hammering it with retries on an exponential or fixed schedule. There is no way to declaratively configure linear or polynomial backoff curves, apply AWS-style decorrelated jitter, set a maximum delay cap, vary backoff behavior based on error type, or pause job fetching entirely when failures exceed a threshold. The custom `backoffStrategy` callback exists but forces every consumer to reimplement common patterns.
- **Why does it matter?** Production job queues interact with services that have varied failure modes: transient errors recover quickly, rate limit errors need longer cooldowns, and full outages need circuit breaking to avoid wasting resources and compounding the problem. Built-in support for these patterns reduces boilerplate, improves consistency across workers, and provides operational visibility through events.

### Success metrics


|                      Metric                      |         Baseline          |                              Target                               | Validation method |
| ------------------------------------------------ | ------------------------- | ----------------------------------------------------------------- | ----------------- |
| Linear backoff strategy works                    | Not available             | Jobs retried with linearly increasing delay                       | Unit tests        |
| Polynomial backoff strategy works                | Not available             | Jobs retried with polynomial delay curve                          | Unit tests        |
| Decorrelated jitter strategy works               | Not available             | Delays fall within AWS-style decorrelated jitter bounds           | Unit tests        |
| Per-error-type backoff resolves correct strategy | Not available             | Different error classes produce different delays                  | Unit tests        |
| Backoff cap limits maximum delay                 | No cap support            | Delay never exceeds configured cap regardless of strategy         | Unit tests        |
| Circuit breaker opens after threshold failures   | No circuit breaker        | Worker stops fetching after N consecutive failures                | Integration tests |
| Circuit breaker half-open allows test job        | No circuit breaker        | One job processed in half-open state                              | Integration tests |
| Circuit breaker closes on recovery               | No circuit breaker        | Worker resumes normal fetching after successful test job          | Integration tests |
| Circuit breaker events emitted                   | No circuit breaker events | `circuit:open`, `circuit:half-open`, `circuit:closed` events fire | Integration tests |
| Existing `fixed` and `exponential` unchanged     | Current behavior          | Identical behavior, all existing backoff tests pass               | `npm test`        |
| All existing tests pass                          | 100% pass                 | 100% pass (no regressions)                                        | `npm test`        |
| TypeScript compiles                              | Compiles                  | Compiles with new types                                           | `npm run tsc:all` |
| Lint clean                                       | Clean                     | Clean                                                             | `npm run lint`    |


## Scope & Constraints


### In scope

- Three new built-in backoff strategies: `linear`, `polynomial`, `decorrelatedJitter`
- `maxDelay` cap option on `BackoffOptions` (applies to any strategy)
- Per-error-type backoff configuration via `errorBackoffs` option on job options
- Circuit breaker on Worker with configurable `threshold`, `duration`, and `halfOpenAfter`
- Circuit breaker states: CLOSED, OPEN, HALF_OPEN with state transitions
- Circuit breaker events: `circuit:open`, `circuit:half-open`, `circuit:closed`
- `worker.getCircuitBreakerState()` API method
- TypeScript interface updates for all new options
- Comprehensive test suite for new strategies and circuit breaker behavior

### Out of scope

- Redis-backed circuit breaker state (circuit breaker is per-Worker instance, local state only; multi-worker coordination is not covered)
- Circuit breaker affecting job state (jobs stay in waiting; the worker just stops fetching)
- Changes to existing Lua scripts (all new behavior is in the TypeScript layer)
- Circuit breaker on Queue or QueueEvents (only on Worker)
- Dashboard or UI for circuit breaker state
- Distributed circuit breaker coordination across multiple Worker instances

### Dependencies & Risks

- **Backwards compatibility**: All new backoff strategies are additive. The `fixed` and `exponential` strategies must not change behavior. The `BackoffOptions` interface gains optional fields (`maxDelay`); existing code that omits them is unaffected. The `WorkerOptions` interface gains an optional `circuitBreaker` field.
- **Worker processing loop complexity**: The circuit breaker modifies the Worker's job fetching behavior, which is the most complex async loop in the codebase (`run` method, ~50 lines of loop logic). Changes must not introduce race conditions or break the existing pause/resume/close lifecycle.
- **Timer-based testing**: Circuit breaker tests involve time-dependent state transitions (duration, halfOpenAfter). Tests need to use controlled timing (e.g., short durations like 100-500ms) to avoid flakiness, similar to existing stalled job tests.
- **Test infrastructure**: Tests require Redis running via `docker-compose up -d`. The `npm run pretest` step is not needed since no Lua scripts are modified.
- **Custom strategy interaction**: The existing `backoffStrategy` callback on WorkerOptions must continue to work. If a job uses a custom type that matches a new built-in name (unlikely but possible), the built-in takes precedence (matching current behavior where built-ins are checked first).

## Functional Requirements


### BACKOFF-1: Linear backoff strategy


**Required behavior:**


A `linear` backoff strategy where delay increases by a fixed step per attempt:


```typescript
const queue = new Queue('work');
await queue.add('job', data, {
  attempts: 5,
  backoff: {
    type: 'linear',
    delay: 1000, // base delay and step size in ms
  }
});
```


Formula: `delay = baseDelay * attemptsMade`


| Attempt | Delay  |
| ------- | ------ |
| 1       | 1000ms |
| 2       | 2000ms |
| 3       | 3000ms |
| 4       | 4000ms |


When jitter is configured (`jitter: 0.25`), the same jitter approach used by `fixed` and `exponential` applies: the computed delay is randomized within `[delay * (1 - jitter), delay]`.


**Acceptance criteria:**

- `backoff: { type: 'linear', delay: 1000 }` produces delays of 1000, 2000, 3000, ... ms
- Jitter option works identically to existing strategies
- Strategy is registered in `Backoffs.builtinStrategies`
- Invalid `delay` (negative, zero, non-number) falls through to existing validation

### BACKOFF-2: Polynomial backoff strategy


**Required behavior:**


A `polynomial` backoff strategy with a configurable exponent:


```typescript
await queue.add('job', data, {
  attempts: 5,
  backoff: {
    type: 'polynomial',
    delay: 1000,   // base delay in ms
    exponent: 3,   // cubic growth
  }
});
```


Formula: `delay = baseDelay * (attemptsMade ^ exponent)`


| Attempt | Exponent 2 | Exponent 3 |
| ------- | ---------- | ---------- |
| 1       | 1000ms     | 1000ms     |
| 2       | 4000ms     | 8000ms     |
| 3       | 9000ms     | 27000ms    |
| 4       | 16000ms    | 64000ms    |


When `exponent` is not provided, it defaults to `2` (quadratic). This is distinct from the existing `exponential` strategy (which uses `2^attemptsMade * delay`).


Jitter applies the same way as other strategies.


**Acceptance criteria:**

- `backoff: { type: 'polynomial', delay: 1000 }` uses exponent 2 by default
- `backoff: { type: 'polynomial', delay: 1000, exponent: 3 }` uses cubic growth
- Jitter option works identically to existing strategies
- `exponent` must be a positive number; non-positive values throw during strategy resolution
- Strategy is registered in `Backoffs.builtinStrategies`

### BACKOFF-3: Decorrelated jitter backoff strategy


**Required behavior:**


An AWS-style decorrelated jitter strategy that produces less correlated retry storms than standard exponential-with-jitter:


```typescript
await queue.add('job', data, {
  attempts: 10,
  backoff: {
    type: 'decorrelatedJitter',
    delay: 1000,    // base delay in ms (also minimum delay)
    maxDelay: 30000 // cap
  }
});
```


Formula (per AWS architecture blog):


```text
delay = min(maxDelay, random_between(baseDelay, previousDelay * 3))
```


Where `previousDelay` starts at `baseDelay` for the first attempt. Each subsequent attempt uses the previous computed delay as input, producing a random walk that stays bounded.


Since this strategy depends on the previous delay, it must track state. The previous delay is stored in the job's data (e.g., `job.data.__bullmq_prevDelay` or a dedicated job option field) so it survives across attempts.


The `jitter` option on `BackoffOptions` is ignored for this strategy (jitter is inherent to the algorithm).


**Acceptance criteria:**

- `backoff: { type: 'decorrelatedJitter', delay: 1000 }` produces delays in `[1000, previousDelay * 3]` range
- Delays are capped at `maxDelay` when provided
- Without `maxDelay`, delays grow unbounded (but practically limited by `previousDelay * 3` random walk)
- Previous delay state is persisted across job attempts
- First attempt uses `baseDelay` as the previous delay seed
- Successive delays are non-deterministic (randomized)
- Strategy is registered in `Backoffs.builtinStrategies`

### BACKOFF-4: Maximum delay cap (`maxDelay`)


**Required behavior:**


A `maxDelay` option on `BackoffOptions` that caps the computed delay for any strategy:


```typescript
await queue.add('job', data, {
  attempts: 20,
  backoff: {
    type: 'exponential',
    delay: 1000,
    maxDelay: 60000  // never wait more than 60 seconds
  }
});
```


Without `maxDelay`, exponential backoff on attempt 15 would be `2^14 * 1000 = 16,384,000ms` (~4.5 hours). With `maxDelay: 60000`, it caps at 60 seconds.


The cap is applied after the strategy computes the raw delay and after jitter is applied. This keeps the logic orthogonal: strategies compute, `maxDelay` clamps.


**Acceptance criteria:**

- `maxDelay` caps computed delay for `fixed`, `exponential`, `linear`, `polynomial`, and `decorrelatedJitter`
- `maxDelay` also caps delays from custom `backoffStrategy` callbacks
- When the computed delay is below `maxDelay`, it passes through unchanged
- `maxDelay: 0` is treated as "no cap" (not "zero delay")
- `maxDelay` must be a positive number or 0; negative values throw during strategy resolution
- When `maxDelay` is not set, behavior is identical to current (no cap)

### BACKOFF-5: Per-error-type backoff configuration


**Required behavior:**


An `errorBackoffs` option on job options that maps error class names or custom error identifiers to specific backoff configurations:


```typescript
await queue.add('job', data, {
  attempts: 10,
  backoff: {
    type: 'exponential',
    delay: 1000
  },
  errorBackoffs: {
    'RateLimitError': { type: 'fixed', delay: 30000 },
    'TimeoutError': { type: 'linear', delay: 2000 },
    'TransientError': { type: 'exponential', delay: 500, maxDelay: 10000 }
  }
});
```


When a job fails and is eligible for retry:

1. Check `error.name` against keys in `errorBackoffs`
2. If a match is found, use that backoff configuration instead of the default `backoff`
3. If no match, fall back to the default `backoff` option

Error matching uses `error.name` (the standard JS error property). This works with both built-in error types (`TypeError`, `RangeError`) and custom error classes where `name` is set.


**Acceptance criteria:**

- `errorBackoffs` maps error names to `BackoffOptions`
- When the thrown error's `name` matches a key, that backoff config is used
- When no match, the default `backoff` option is used
- When `errorBackoffs` is set but `backoff` is not, unmatched errors use no backoff (immediate retry at delay 0)
- `errorBackoffs` is optional and omitting it preserves current behavior exactly
- Works with both built-in strategies and custom `backoffStrategy`
- `maxDelay` on individual `errorBackoffs` entries is respected

### CB-1: Circuit breaker configuration


**Required behavior:**


Workers accept a `circuitBreaker` option:


```typescript
const worker = new Worker('queue', processor, {
  circuitBreaker: {
    threshold: 5,       // failures to trigger OPEN
    duration: 30000,    // how long to stay OPEN before transitioning to HALF_OPEN
    halfOpenMaxAttempts: 1  // jobs to test in HALF_OPEN before closing (default 1)
  }
});
```


|        Option         |  Type  | Required | Default |                        Description                        |
| --------------------- | ------ | -------- | ------- | --------------------------------------------------------- |
| `threshold`           | number | Yes      | -       | Consecutive failures before opening the circuit           |
| `duration`            | number | Yes      | -       | Time in ms to stay OPEN before transitioning to HALF_OPEN |
| `halfOpenMaxAttempts` | number | No       | 1       | Number of test jobs to allow through in HALF_OPEN         |


All values must be positive integers. Invalid values throw during Worker construction.


When `circuitBreaker` is not configured, the Worker behaves identically to current behavior (no circuit breaker logic executes).


**Acceptance criteria:**

- `circuitBreaker` option is accepted on WorkerOptions
- Invalid configurations (negative numbers, missing required fields) throw on Worker construction
- Omitting `circuitBreaker` produces identical behavior to current BullMQ
- Configuration is accessible via `worker.opts.circuitBreaker`

### CB-2: Circuit breaker state machine


**Required behavior:**


The circuit breaker has three states:


**CLOSED** (normal operation):

- Worker fetches and processes jobs normally
- A sliding window tracks consecutive failures
- When consecutive failures reach `threshold`, transition to OPEN
- Any successful job completion resets the failure counter to 0

**OPEN** (circuit tripped):

- Worker stops fetching new jobs (the processing loop skips `moveToActive`)
- Jobs remain in the waiting state; they are not lost or moved
- A timer starts for `duration` milliseconds
- When the timer fires, transition to HALF_OPEN
- If the worker is paused while OPEN, the circuit breaker timer continues independently

**HALF_OPEN** (testing recovery):

- Worker fetches exactly `halfOpenMaxAttempts` job(s)
- If the test job(s) succeed: transition to CLOSED, resume normal fetching
- If any test job fails: transition back to OPEN, restart the duration timer
- While in HALF_OPEN, no additional jobs are fetched beyond `halfOpenMaxAttempts`

State transitions:


```text
CLOSED --[threshold failures]--> OPEN
OPEN   --[duration elapsed]----> HALF_OPEN
HALF_OPEN --[success]----------> CLOSED
HALF_OPEN --[failure]----------> OPEN
```


**Acceptance criteria:**

- Circuit breaker starts in CLOSED state
- Consecutive failures at or above `threshold` trigger OPEN
- A success in CLOSED resets the failure counter
- OPEN state prevents job fetching for `duration` ms
- After `duration`, state transitions to HALF_OPEN
- Successful test job in HALF_OPEN transitions to CLOSED
- Failed test job in HALF_OPEN transitions back to OPEN
- `worker.getCircuitBreakerState()` returns current state: `'closed'`, `'open'`, or `'half-open'`
- When circuit breaker is not configured, `getCircuitBreakerState()` returns `undefined`

### CB-3: Circuit breaker events


**Required behavior:**


The Worker emits events on circuit breaker state transitions:


```typescript
worker.on('circuit:open', ({ failures, threshold }) => {
  console.log(`Circuit opened after ${failures} failures`);
});

worker.on('circuit:half-open', ({ duration }) => {
  console.log(`Circuit half-open after ${duration}ms cooldown`);
});

worker.on('circuit:closed', ({ testJobId }) => {
  console.log(`Circuit closed after successful test job ${testJobId}`);
});
```


Event payloads:


|        Event        |                  Payload                  |                     When                      |
| ------------------- | ----------------------------------------- | --------------------------------------------- |
| `circuit:open`      | `{ failures: number, threshold: number }` | Failure count reaches threshold               |
| `circuit:half-open` | `{ duration: number }`                    | Duration timer fires, entering test phase     |
| `circuit:closed`    | `{ testJobId: string }`                   | Test job succeeded, resuming normal operation |


**Acceptance criteria:**

- `circuit:open` fires exactly once per CLOSED -> OPEN transition
- `circuit:half-open` fires exactly once per OPEN -> HALF_OPEN transition
- `circuit:closed` fires exactly once per HALF_OPEN -> CLOSED transition
- Events include the documented payload fields
- Events are typed in the `WorkerListener` interface
- No circuit breaker events fire when `circuitBreaker` is not configured

### CB-4: Circuit breaker interaction with Worker lifecycle


**Required behavior:**


The circuit breaker integrates cleanly with the Worker's existing lifecycle:

- **close()**: Closing the worker while OPEN or HALF_OPEN clears any circuit breaker timers and does not prevent clean shutdown
- **pause()**: Pausing while OPEN keeps the circuit breaker timer running. When the worker is resumed and the circuit is now HALF_OPEN, it processes a test job
- **resume()**: Resuming a paused worker respects the current circuit breaker state
- **Stall detection**: Stalled jobs do not count toward the circuit breaker failure threshold (stalls are infrastructure issues, not downstream failures)

**Acceptance criteria:**

- `worker.close()` during OPEN state completes cleanly without waiting for the duration timer
- `worker.pause()` does not reset circuit breaker state
- Stalled job events do not increment the circuit breaker failure counter
- The circuit breaker timer does not prevent the Worker's `close()` from resolving

## Technical Solution


### Architecture & Components


**Modified files:**


|                 File                 |                                                                               Change                                                                                |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/classes/backoffs.ts`            | Add `linear`, `polynomial`, `decorrelatedJitter` strategies to `builtinStrategies`. Add `maxDelay` clamping logic in `calculate()`. Add `errorBackoffs` resolution. |
| `src/classes/worker.ts`              | Add `CircuitBreaker` integration in the processing loop. Add `getCircuitBreakerState()` method. Add circuit breaker events to `WorkerListener`.                     |
| `src/interfaces/backoff-options.ts`  | Add `maxDelay?: number` and `exponent?: number` fields                                                                                                              |
| `src/interfaces/base-job-options.ts` | Add `errorBackoffs?: Record<string, BackoffOptions>` field                                                                                                          |
| `src/interfaces/worker-options.ts`   | Add `circuitBreaker?: CircuitBreakerOptions` field                                                                                                                  |


**New files:**


|                    File                     |                                     Purpose                                     |
| ------------------------------------------- | ------------------------------------------------------------------------------- |
| `src/classes/circuit-breaker.ts`            | `CircuitBreaker` class encapsulating state machine, timer, and failure tracking |
| `src/interfaces/circuit-breaker-options.ts` | `CircuitBreakerOptions` interface definition                                    |
| `src/enums/circuit-breaker-state.ts`        | `CircuitBreakerState` enum (`CLOSED`, `OPEN`, `HALF_OPEN`)                      |
| `tests/backoff-strategies.test.ts`          | Tests for new backoff strategies, maxDelay, errorBackoffs                       |
| `tests/circuit-breaker.test.ts`             | Tests for circuit breaker state machine, events, lifecycle                      |


### Implementation notes


**Backoff strategies (`src/classes/backoffs.ts`):**


New strategies follow the existing factory pattern in `builtinStrategies`:


```typescript
linear: (delay: number, jitter?: number) => {
  return (attemptsMade: number) => {
    const rawDelay = delay * attemptsMade;
    if (!jitter) return rawDelay;
    const min = rawDelay * (1 - jitter);
    return min + Math.random() * (rawDelay * jitter);
  };
},

polynomial: (delay: number, jitter?: number, exponent = 2) => {
  return (attemptsMade: number) => {
    const rawDelay = delay * Math.pow(attemptsMade, exponent);
    if (!jitter) return rawDelay;
    const min = rawDelay * (1 - jitter);
    return min + Math.random() * (rawDelay * jitter);
  };
},
```


The `decorrelatedJitter` strategy needs access to previous delay, so `Backoffs.calculate()` must accept and return state, or the strategy must read it from the job.


The `exponent` field is read from `BackoffOptions` and passed to the polynomial factory. Since the current factory signature is `(delay, jitter?)`, extend it to accept the full `BackoffOptions` object for strategies that need additional fields. The built-in lookup can pass the options through.


**maxDelay clamping:**


Applied in `Backoffs.calculate()` after the strategy returns the raw delay:


```typescript
let computedDelay = strategy(attemptsMade, ...);
if (backoff.maxDelay && backoff.maxDelay > 0 && computedDelay > backoff.maxDelay) {
  computedDelay = backoff.maxDelay;
}
return computedDelay;
```


**Per-error-type backoff:**


In `Job.shouldRetryJob()`, before calling `Backoffs.calculate()`:


```typescript
const effectiveBackoff = (this.opts.errorBackoffs?.[err?.name]) 
  ? this.opts.errorBackoffs[err.name]
  : this.opts.backoff;
```


This resolution happens at the job level, keeping the `Backoffs` class stateless and focused on computation.


**Circuit breaker (`src/classes/circuit-breaker.ts`):**


Self-contained state machine class:


```typescript
class CircuitBreaker {
  private state: CircuitBreakerState = CircuitBreakerState.CLOSED;
  private failureCount = 0;
  private durationTimer?: ReturnType<typeof setTimeout>;

  constructor(private opts: CircuitBreakerOptions) {}

  recordSuccess(): CircuitBreakerState { /* reset or transition */ }
  recordFailure(): CircuitBreakerState { /* increment or transition */ }
  getState(): CircuitBreakerState { /* current state */ }
  shouldAllowJob(): boolean { /* CLOSED=true, OPEN=false, HALF_OPEN=limited */ }
  close(): void { /* cleanup timers */ }
}
```


The Worker creates a `CircuitBreaker` instance if `opts.circuitBreaker` is set. In the processing loop, before calling `moveToActive`, the worker checks `circuitBreaker.shouldAllowJob()`. After job completion/failure, it calls `recordSuccess()` or `recordFailure()` and emits events on state transitions.


**Worker integration (`src/classes/worker.ts`):**


The circuit breaker hooks into two points:

1. **Job fetching** (in the `run()` loop): Before `_getNextJob()`, check `circuitBreaker.shouldAllowJob()`. If `false`, wait (using a promise that resolves when the circuit transitions to HALF_OPEN or CLOSED) instead of blocking on Redis.
2. **Job completion/failure** (in `handleCompleted()` / `handleFailed()`): Call `circuitBreaker.recordSuccess()` or `circuitBreaker.recordFailure()`. On state transitions, emit the appropriate event.

The circuit breaker wait mechanism should be interruptible by `close()` and `pause()` to maintain clean lifecycle behavior.


### Dependency changes


None. All implementations use standard TypeScript and Node.js built-ins.


## Validation Contract


### VAL-01: Linear backoff produces linearly increasing delays


```text
GIVEN a job with attempts: 4 and backoff: { type: 'linear', delay: 1000 }
AND the worker processor always throws
WHEN the job is processed and retried
THEN the delays between attempts are approximately 1000ms, 2000ms, 3000ms
```


### VAL-02: Polynomial backoff with default exponent (quadratic)


```text
GIVEN a job with attempts: 4 and backoff: { type: 'polynomial', delay: 500 }
AND the worker processor always throws
WHEN the job is processed and retried
THEN the delays between attempts are approximately 500ms, 2000ms, 4500ms
(500*1^2, 500*2^2, 500*3^2)
```


### VAL-03: Polynomial backoff with custom exponent


```text
GIVEN a job with attempts: 3 and backoff: { type: 'polynomial', delay: 100, exponent: 3 }
AND the worker processor always throws
WHEN the job is processed and retried
THEN the delays between attempts are approximately 100ms, 800ms
(100*1^3, 100*2^3)
```


### VAL-04: Decorrelated jitter stays within bounds


```text
GIVEN a job with attempts: 10 and backoff: { type: 'decorrelatedJitter', delay: 1000, maxDelay: 30000 }
AND the worker processor always throws
WHEN the job is processed and retried multiple times
THEN each delay is >= 1000ms (base delay)
AND each delay is <= 30000ms (maxDelay cap)
AND delays are not monotonically increasing (randomness present)
```


### VAL-05: maxDelay caps exponential backoff


```text
GIVEN a job with attempts: 15 and backoff: { type: 'exponential', delay: 1000, maxDelay: 10000 }
AND the worker processor always throws
WHEN the job reaches attempt 5 (raw delay = 2^4 * 1000 = 16000ms)
THEN the actual delay is 10000ms (capped by maxDelay)
```


### VAL-06: maxDelay caps linear backoff


```text
GIVEN a job with attempts: 10 and backoff: { type: 'linear', delay: 5000, maxDelay: 15000 }
AND the worker processor always throws
WHEN the job reaches attempt 4 (raw delay = 5000 * 4 = 20000ms)
THEN the actual delay is 15000ms (capped by maxDelay)
```


### VAL-07: Per-error-type backoff selects correct strategy


```text
GIVEN a job with backoff: { type: 'exponential', delay: 1000 }
AND errorBackoffs: { 'RateLimitError': { type: 'fixed', delay: 30000 } }
AND the worker throws a RateLimitError (error.name === 'RateLimitError')
WHEN the job fails and is retried
THEN the retry delay is 30000ms (fixed, from the error-specific config)
```


### VAL-08: Per-error-type backoff falls back to default


```text
GIVEN a job with backoff: { type: 'exponential', delay: 1000 }
AND errorBackoffs: { 'RateLimitError': { type: 'fixed', delay: 30000 } }
AND the worker throws a TypeError (not in errorBackoffs)
WHEN the job fails and is retried
THEN the retry delay uses exponential backoff at 1000ms base (the default)
```


### VAL-09: Existing fixed backoff unchanged


```text
GIVEN a job with attempts: 3 and backoff: { type: 'fixed', delay: 2000 }
AND the worker processor always throws
WHEN the job is processed and retried
THEN the delay between each attempt is approximately 2000ms
```


### VAL-10: Existing exponential backoff unchanged


```text
GIVEN a job with attempts: 4 and backoff: { type: 'exponential', delay: 1000 }
AND the worker processor always throws
WHEN the job is processed and retried
THEN the delays are approximately 1000ms, 2000ms, 4000ms
```


### VAL-11: Circuit breaker opens after threshold failures


```text
GIVEN a worker with circuitBreaker: { threshold: 3, duration: 5000, halfOpenAfter: 2500 }
AND the processor always throws
WHEN 3 consecutive jobs fail
THEN worker.getCircuitBreakerState() returns 'open'
AND a 'circuit:open' event is emitted with { failures: 3, threshold: 3 }
AND the worker stops fetching new jobs
```


### VAL-12: Circuit breaker transitions to half-open after duration


```text
GIVEN the circuit breaker is OPEN with duration: 500
WHEN 500ms elapses
THEN worker.getCircuitBreakerState() returns 'half-open'
AND a 'circuit:half-open' event is emitted
```


### VAL-13: Circuit breaker closes on successful test job


```text
GIVEN the circuit breaker is HALF_OPEN
AND a job is waiting in the queue
AND the processor succeeds for the next job
WHEN the worker processes the test job
THEN worker.getCircuitBreakerState() returns 'closed'
AND a 'circuit:closed' event is emitted with { testJobId: <the job id> }
AND the worker resumes fetching jobs normally
```


### VAL-14: Circuit breaker reopens on failed test job


```text
GIVEN the circuit breaker is HALF_OPEN
AND the processor throws for the next job
WHEN the worker processes the test job
THEN worker.getCircuitBreakerState() returns 'open'
AND the duration timer restarts
```


### VAL-15: Success resets failure counter in CLOSED state


```text
GIVEN a worker with circuitBreaker: { threshold: 3, duration: 5000 }
AND 2 consecutive jobs have failed
WHEN the next job succeeds
THEN the failure counter resets to 0
AND the circuit remains CLOSED
AND subsequent failures start counting from 0
```


### VAL-16: Circuit breaker state returns undefined when not configured


```text
GIVEN a worker with no circuitBreaker option
WHEN I call worker.getCircuitBreakerState()
THEN the return value is undefined
```


### VAL-17: Worker close during OPEN state completes cleanly


```text
GIVEN the circuit breaker is OPEN with duration: 60000
WHEN worker.close() is called
THEN the close promise resolves without waiting for the duration timer
AND no circuit breaker events fire after close
```


### VAL-18: Stalled jobs do not affect circuit breaker


```text
GIVEN a worker with circuitBreaker: { threshold: 3, duration: 5000 }
AND 2 consecutive jobs have failed (counter at 2)
WHEN a job is detected as stalled
THEN the failure counter remains at 2 (stall does not increment it)
```


### VAL-19: Jitter on new strategies produces values in range


```text
GIVEN a job with backoff: { type: 'linear', delay: 1000, jitter: 0.5 }
AND the worker processor always throws
WHEN the job fails on attempt 2 (raw delay = 2000ms)
THEN the actual delay is between 1000ms and 2000ms (jitter range: [2000*0.5, 2000])
```


### VAL-20: No regressions in existing test suite


```text
GIVEN all changes are applied
WHEN I run npm test
THEN all existing tests pass
AND when I run npm run tsc:all
THEN TypeScript compilation succeeds
AND when I run npm run lint
THEN no lint errors
```


---

# Technical Context
# Technical Context: Configurable Backoff Strategies and Circuit Breaker

## Verified Tech Stack

From `package.json` (dependencies section):
- Language: TypeScript 5.9.3 (`typescript: 5.9.3` in devDependencies)
- Runtime types: Node.js 18.x (`@types/node: 18.19.130`)
- Redis client: ioredis 5.9.3 (`ioredis: 5.9.3`)
- Package manager: Yarn 1.22.22 (`packageManager: yarn@1.22.22`)

From `package.json` (devDependencies section):
- Test framework: Vitest 4.0.18 (`vitest: 4.0.18`)
- Coverage: `@vitest/coverage-v8: 4.0.18`
- Linter: ESLint 9.39.2, `@typescript-eslint/eslint-plugin: 8.54.0`
- Formatter: Prettier 3.8.1

Test command: `vitest run --no-file-parallelism` (sequential, no parallel test files)

---

## Relevant Files & Patterns

### Files to modify

- `src/classes/backoffs.ts` — Contains `Backoffs` class, `BuiltInStrategies` interface, `lookupStrategy` private function. New strategies are added to `builtinStrategies`. `maxDelay` clamping goes in `calculate()`. `errorBackoffs` resolution goes in `shouldRetryJob()` in `job.ts`, not here.
- `src/classes/worker.ts` — Contains `Worker` class, `WorkerListener` interface, `mainLoop()`, `handleCompleted()`, `handleFailed()`, `_getNextJob()`, constructor validation, `close()`, `pause()`, `resume()`. Circuit breaker integrates at all these points.
- `src/interfaces/backoff-options.ts` — Add `maxDelay?: number` and `exponent?: number` to `BackoffOptions`.
- `src/interfaces/base-job-options.ts` — Add `errorBackoffs?: Record<string, BackoffOptions>` to `DefaultJobOptions` or `BaseJobOptions`.
- `src/interfaces/worker-options.ts` — Add `circuitBreaker?: CircuitBreakerOptions` to `WorkerOptions`.
- `src/classes/job.ts` — `shouldRetryJob()` (line 774) is where `errorBackoffs` lookup replaces `this.opts.backoff` with the error-specific config before calling `Backoffs.calculate()`.

### New files to create

- `src/classes/circuit-breaker.ts` — `CircuitBreaker` class
- `src/interfaces/circuit-breaker-options.ts` — `CircuitBreakerOptions` interface
- `src/enums/circuit-breaker-state.ts` — `CircuitBreakerState` enum
- `tests/backoff-strategies.test.ts` — Unit/integration tests for new backoff strategies
- `tests/circuit-breaker.test.ts` — Integration tests for circuit breaker state machine

### Supporting files (read, do not modify)

- `src/types/backoff-strategy.ts` — `BackoffStrategy` type: `(attemptsMade: number, type?: string, err?: Error, job?: MinimalJob) => Promise<number> | number`
- `src/interfaces/minimal-job.ts` — `MinimalJob` interface; already accessible in `Backoffs.calculate()` as the `job` parameter for decorrelatedJitter state storage
- `src/classes/errors/index.ts` — Error class exports; `UnrecoverableError`, `DelayedError`, `RateLimitError` etc.

---

## Existing Patterns to Follow

### Backoff strategy factory pattern (`src/classes/backoffs.ts`, `builtinStrategies` object)

Existing strategies use this factory pattern (inner function matches `BackoffStrategy` type):

```typescript
// Current pattern in builtinStrategies:
fixed: function (delay: number, jitter = 0) {
  return function (): number {
    // returns computed delay
  };
},
exponential: function (delay: number, jitter = 0) {
  return function (attemptsMade: number): number {
    return Math.round(Math.pow(2, attemptsMade - 1) * delay);
  };
},
```

The `BuiltInStrategies` interface is currently typed as `(delay: number, jitter?: number) => BackoffStrategy`. For `polynomial` (needs `exponent`) and `decorrelatedJitter` (needs job data access), the factory signature must be extended. The `lookupStrategy` function (line 65) passes `backoff.delay!` and `backoff.jitter` to the factory — extend it to pass the full `BackoffOptions` object and update `BuiltInStrategies` accordingly:

```typescript
// Extend interface to accept full options:
export interface BuiltInStrategies {
  [index: string]: (opts: BackoffOptions) => BackoffStrategy;
}

// lookupStrategy passes full backoff opts to factory:
return Backoffs.builtinStrategies[backoff.type](backoff);
```

### `maxDelay` clamping location (`src/classes/backoffs.ts`, `calculate()` method, line 50)

`calculate()` calls `strategy(attemptsMade, backoff.type, err, job)` and returns the result. Apply `maxDelay` clamping after the strategy returns:

```typescript
static calculate(...): Promise<number> | number | undefined {
  if (backoff) {
    const strategy = lookupStrategy(backoff, customStrategy);
    let computedDelay = strategy(attemptsMade, backoff.type, err, job);
    // maxDelay clamping here after strategy result
    if (backoff.maxDelay && backoff.maxDelay > 0) {
      // handle Promise<number> case with async resolution
    }
    return computedDelay;
  }
}
```

Note: `calculate()` can return `Promise<number> | number | undefined`. Handle the `maxDelay` clamp for both synchronous and `Promise`-returning strategies.

### `errorBackoffs` lookup location (`src/classes/job.ts`, `shouldRetryJob()`, line 774)

```typescript
// Current code at line 782:
const delay = await Backoffs.calculate(
  <BackoffOptions>this.opts.backoff,
  this.attemptsMade + 1,
  err,
  this,
  opts.settings && opts.settings.backoffStrategy,
);

// Modified pattern — resolve effective backoff before calling calculate():
const effectiveBackoff = this.opts.errorBackoffs?.[err?.name]
  ?? this.opts.backoff;
const delay = await Backoffs.calculate(
  <BackoffOptions>effectiveBackoff,
  this.attemptsMade + 1,
  err,
  this,
  opts.settings && opts.settings.backoffStrategy,
);
```

### `decorrelatedJitter` state persistence

`Backoffs.calculate()` already receives `job: MinimalJob`. The previous delay can be stored in `job.data` (e.g., `job.data.__bullmq_prevDelay`) and updated after each computation. The `BackoffStrategy` function signature receives `job` as the 4th argument, so the inner returned function has access to it via closure from the factory.

### Worker constructor validation pattern (`src/classes/worker.ts`, lines 244–266)

```typescript
if (
  typeof this.opts.maxStalledCount !== 'number' ||
  this.opts.maxStalledCount < 0
) {
  throw new Error('maxStalledCount must be greater or equal than 0');
}
```

Validate `circuitBreaker` options using the same `typeof` + condition guard pattern. Throw synchronously from the constructor if `threshold`, `duration`, or `halfOpenMaxAttempts` are invalid.

### Interruptible wait pattern (`src/classes/worker.ts`, `waitForRateLimit()`, lines 565–577)

The rate limiter uses `abortDelayController: AbortController` (from `node-abort-controller`) to make waits interruptible by `close()` and `pause()`. Circuit breaker OPEN-state waiting should follow the same pattern — use `this.abortDelayController` so that `close()` calling `this.abortDelayController?.abort()` (line 1250) also interrupts the circuit breaker wait.

### Worker event emission pattern (`src/classes/worker.ts`, `WorkerListener` interface, lines 53–174)

New events follow the existing `WorkerListener` interface pattern:

```typescript
// Existing pattern:
failed: (job: Job<...> | undefined, error: Error, prev: string) => void;
stalled: (jobId: string, prev: string) => void;
```

Add circuit breaker events to `WorkerListener` following the same typed signature format before the closing `}`.

### Enum registration pattern (`src/enums/index.ts`)

```typescript
// Current barrel:
export * from './child-command';
export * from './error-code';
// ...
```

Add `export * from './circuit-breaker-state';` to `src/enums/index.ts`.

### Interface registration pattern (`src/interfaces/index.ts`)

```typescript
// Current barrel includes all interfaces:
export * from './worker-options';
export * from './backoff-options';
// ...
```

Add `export * from './circuit-breaker-options';` to `src/interfaces/index.ts`.

### mainLoop circuit breaker check point (`src/classes/worker.ts`, inner fetch loop, line 598)

The inner fetch loop currently guards with:
```typescript
while (
  !this.closing &&
  !this.paused &&
  !this.waiting &&
  asyncFifoQueue.numTotal() < this._concurrency &&
  !this.isRateLimited()   // <-- rate limiter guard
) {
```

Add circuit breaker guard here: `&& this.circuitBreaker?.shouldAllowJob() !== false`. When OPEN, the outer loop should wait (via `abortDelayController`-based delay) analogous to `waitForRateLimit()`.

### handleCompleted / handleFailed hook points (`src/classes/worker.ts`, lines 1068 and 1100)

`handleCompleted()` emits `'completed'` after `job.moveToCompleted()`. `handleFailed()` emits `'failed'` after `job.moveToFailed()`. Circuit breaker `recordSuccess()` and `recordFailure()` calls (and subsequent event emission) belong immediately after the `this.emit('completed', ...)` and `this.emit('failed', ...)` calls respectively.

Stalled jobs are handled in `moveStalledJobsToWait()` (line 1397) — this path does NOT call `handleFailed()`, so the circuit breaker counter is NOT incremented, which is the correct behavior per the PRD.

---

## Integration Points

- **`src/classes/backoffs.ts` ↔ `src/classes/job.ts`**: `Backoffs.calculate()` is called from `shouldRetryJob()` in `job.ts`. The `errorBackoffs` lookup changes the `backoff` argument passed to `calculate()`; `Backoffs` itself remains stateless. The `BuiltInStrategies` interface change in `backoffs.ts` affects the factory call in `lookupStrategy()` only.
- **`src/classes/circuit-breaker.ts` ↔ `src/classes/worker.ts`**: `Worker` instantiates `CircuitBreaker` in the constructor if `opts.circuitBreaker` is set. Integration is at: (1) inner fetch loop condition, (2) `handleCompleted()`, (3) `handleFailed()`, (4) `close()` cleanup (timer clearance).
- **`src/interfaces/backoff-options.ts` ↔ consumers**: `BackoffOptions` is used by `base-job-options.ts`, `job.ts`, `backoffs.ts`, and exported from `src/interfaces/index.ts`. Adding optional fields is additive and non-breaking.
- **`src/interfaces/worker-options.ts` ↔ `src/classes/worker.ts`**: `WorkerOptions` drives `this.opts` throughout Worker. The new `circuitBreaker` optional field is read in constructor and stored on `this.opts`.
- **`WorkerListener` ↔ typed event emitters**: `WorkerListener` is the typed event map for `Worker.emit()`, `Worker.on()`, and `Worker.off()` (lines 405–420). New circuit breaker events must be added here for TypeScript type-safety; the generic `emit<U extends keyof WorkerListener>` pattern enforces this.

**Impact boundary:** All new behavior is purely TypeScript-layer. No Lua scripts, no Redis schema changes, no external service dependencies. Circuit breaker state is in-memory per Worker instance (not persisted to Redis).

---

## Data Persistence

### New interfaces and types

**`CircuitBreakerOptions`** (new file `src/interfaces/circuit-breaker-options.ts`):
```typescript
export interface CircuitBreakerOptions {
  threshold: number;          // Required: positive integer
  duration: number;           // Required: positive integer (ms)
  halfOpenMaxAttempts?: number; // Optional, default 1
}
```

**`CircuitBreakerState`** enum (new file `src/enums/circuit-breaker-state.ts`):
```typescript
export enum CircuitBreakerState {
  CLOSED = 'closed',
  OPEN = 'open',
  HALF_OPEN = 'half-open',
}
```

**`BackoffOptions`** additions (`src/interfaces/backoff-options.ts`):
```typescript
export interface BackoffOptions {
  type: 'fixed' | 'exponential' | 'linear' | 'polynomial' | 'decorrelatedJitter' | (string & {});
  delay?: number;
  jitter?: number;
  maxDelay?: number;   // NEW: cap applied to any strategy after jitter
  exponent?: number;   // NEW: for polynomial strategy (default 2)
}
```

**`BaseJobOptions`/`DefaultJobOptions`** additions (`src/interfaces/base-job-options.ts`):
```typescript
errorBackoffs?: Record<string, BackoffOptions>; // NEW: keyed by error.name
```

### In-memory state (no Redis persistence)

`CircuitBreaker` class holds mutable in-memory state:
- `state: CircuitBreakerState` — current state
- `failureCount: number` — consecutive failure counter
- `durationTimer?: ReturnType<typeof setTimeout>` — OPEN→HALF_OPEN transition timer
- `halfOpenAttempts: number` — jobs processed in HALF_OPEN state

`decorrelatedJitter` previous delay is stored in `job.data.__bullmq_prevDelay` (persisted to Redis as part of job data — the only Redis-side data change, but no schema/model change is needed since job data is a free-form object).

---

## Technical Constraints

- **No Lua script changes**: The `pretest` step (`generate:raw:scripts`, `transform:commands`, `circular:references`) is required for the build but the PRD confirms no Lua changes. Tests can skip `pretest` and use `vitest run --no-file-parallelism` directly.
- **`BuiltInStrategies` interface extension**: Changing the factory signature from `(delay: number, jitter?: number)` to accept `BackoffOptions` is a breaking change to the internal interface. Since `BuiltInStrategies` is exported from `backoffs.ts`, any external callers using the interface directly will need updates. However, it is not part of the public `src/index.ts` API (check `src/classes/index.ts` exports).
- **`calculate()` return type**: Currently `Promise<number> | number | undefined`. The `maxDelay` clamp must handle both the synchronous and Promise cases without changing the return type signature.
- **`node-abort-controller` polyfill**: Already used for Node < 15.4. Circuit breaker interruptible wait should use `this.abortDelayController` (already on Worker) rather than creating a new AbortController to avoid conflicting with existing rate limiter abort.
- **`halfOpenAfter` vs `duration`**: The PRD uses `duration` for the OPEN timeout and `halfOpenAfter` in test scenarios (VAL-11). The option table in CB-1 only defines `duration`. Use `duration` as the canonical option name.

---

## Testing Strategy

### Test file conventions (from `tests/stalled_jobs.test.ts` and `tests/worker.test.ts`)

```typescript
import { Queue, Worker } from '../src/classes';
import { delay, removeAllQueueData } from '../src/utils';
import { default as IORedis } from 'ioredis';
import { describe, beforeEach, afterEach, beforeAll, afterAll, it, expect } from 'vitest';
import { v4 } from 'uuid';

describe('feature name', () => {
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
  });

  afterAll(async () => { await connection.quit(); });
});
```

Use short `duration` values (100–500ms) for circuit breaker timing tests to avoid flakiness (same approach as `stalledInterval: 100` in `tests/stalled_jobs.test.ts`).

---

### `tests/backoff-strategies.test.ts` — 10 scenarios

**1. Linear strategy produces linearly increasing delays (unit)**
```typescript
it('linear strategy produces delay * attemptsMade', () => {
  const strategy = Backoffs.builtinStrategies.linear({ type: 'linear', delay: 1000 });
  expect(strategy(1)).toBe(1000);
  expect(strategy(2)).toBe(2000);
  expect(strategy(3)).toBe(3000);
});
```

**2. Polynomial strategy uses default exponent 2 (unit)**
```typescript
it('polynomial strategy defaults to exponent 2', () => {
  const strategy = Backoffs.builtinStrategies.polynomial({ type: 'polynomial', delay: 500 });
  expect(strategy(1)).toBe(500);   // 500 * 1^2
  expect(strategy(2)).toBe(2000);  // 500 * 2^2
  expect(strategy(3)).toBe(4500);  // 500 * 3^2
});
```

**3. Polynomial strategy with custom exponent (unit)**
```typescript
it('polynomial strategy uses provided exponent', () => {
  const strategy = Backoffs.builtinStrategies.polynomial({ type: 'polynomial', delay: 100, exponent: 3 });
  expect(strategy(1)).toBe(100);   // 100 * 1^3
  expect(strategy(2)).toBe(800);   // 100 * 2^3
});
```

**4. `maxDelay` caps exponential backoff (unit)**
```typescript
it('maxDelay clamps computed delay', () => {
  const result = Backoffs.calculate(
    { type: 'exponential', delay: 1000, maxDelay: 10000 },
    5,  // attempt 5: raw = 2^4 * 1000 = 16000
    new Error(),
    mockJob,
  );
  expect(result).toBe(10000);
});
```

**5. `maxDelay: 0` treated as no cap (unit)**
```typescript
it('maxDelay 0 does not cap delay', () => {
  const result = Backoffs.calculate(
    { type: 'linear', delay: 5000, maxDelay: 0 },
    4,
    new Error(),
    mockJob,
  );
  expect(result).toBe(20000); // uncapped: 5000 * 4
});
```

**6. Jitter on linear strategy produces values within bounds (unit)**
```typescript
it('linear strategy with jitter produces delay in [delay*(1-jitter), delay]', () => {
  // Run multiple times to verify bounds
  for (let i = 0; i < 100; i++) {
    const strategy = Backoffs.builtinStrategies.linear({ type: 'linear', delay: 1000, jitter: 0.5 });
    const result = strategy(2); // raw = 2000
    expect(result).toBeGreaterThanOrEqual(1000);
    expect(result).toBeLessThanOrEqual(2000);
  }
});
```

**7. `errorBackoffs` selects error-specific strategy (integration)**
```typescript
it('errorBackoffs uses matched error config over default backoff', async () => {
  // Add job with errorBackoffs; throw RateLimitError; verify delay matches fixed 5000
});
```

**8. `errorBackoffs` falls back to default when error not matched (integration)**
```typescript
it('errorBackoffs falls back to default backoff when error.name not in map', async () => {
  // Throw TypeError (not in errorBackoffs); verify default exponential delay used
});
```

**9. `decorrelatedJitter` delays stay within bounds across attempts (integration)**
```typescript
it('decorrelatedJitter delays are >= baseDelay and <= maxDelay', async () => {
  // Run job with decorrelatedJitter, delay: 1000, maxDelay: 10000
  // Collect each retry delay; assert all in [1000, 10000]
});
```

**10. Existing `fixed` and `exponential` strategies unchanged (integration)**
```typescript
it('existing fixed and exponential strategies produce same delays as before', async () => {
  // fixed: 3 attempts at delay 750 should take ~1500ms total (2 retries)
  // exponential: delays are 1000, 2000, 4000
});
```

---

### `tests/circuit-breaker.test.ts` — 10 scenarios

**1. Circuit breaker opens after threshold consecutive failures (integration)**
```typescript
it('circuit opens after threshold failures and emits circuit:open', async () => {
  const worker = new Worker(queueName, async () => { throw new Error('fail'); }, {
    connection, prefix,
    circuitBreaker: { threshold: 3, duration: 60000 },
  });
  // Add 3 jobs, await all failed, check getCircuitBreakerState() === 'open'
  // and verify circuit:open event payload { failures: 3, threshold: 3 }
});
```

**2. Success resets failure counter (integration)**
```typescript
it('success in CLOSED state resets failure counter', async () => {
  // 2 failures, then 1 success → counter resets → circuit stays closed
  // → 2 more failures → still closed (counter at 2, not 4)
});
```

**3. Circuit breaker transitions to half-open after duration (integration)**
```typescript
it('transitions to half-open after duration elapses', async () => {
  const worker = new Worker(queueName, async () => { throw new Error(); }, {
    connection, prefix,
    circuitBreaker: { threshold: 2, duration: 200 },
  });
  // Trigger OPEN, await circuit:half-open event (within ~300ms)
  // Verify getCircuitBreakerState() === 'half-open'
});
```

**4. Successful test job closes circuit (integration)**
```typescript
it('successful test job in half-open transitions to closed', async () => {
  // Reach HALF_OPEN, then process one successful job
  // Verify circuit:closed event with { testJobId: <id> }
  // Verify getCircuitBreakerState() === 'closed'
});
```

**5. Failed test job reopens circuit (integration)**
```typescript
it('failed test job in half-open transitions back to open', async () => {
  // Reach HALF_OPEN, test job fails
  // Verify getCircuitBreakerState() === 'open' and duration timer restarts
});
```

**6. Worker stops fetching jobs while OPEN (integration)**
```typescript
it('worker does not process jobs while circuit is open', async () => {
  // Trigger OPEN, add more jobs, verify they remain in waiting state for duration
});
```

**7. `getCircuitBreakerState()` returns undefined when not configured (unit)**
```typescript
it('returns undefined when circuitBreaker not configured', () => {
  const worker = new Worker(queueName, NoopProc, { connection, prefix });
  expect(worker.getCircuitBreakerState()).toBeUndefined();
});
```

**8. Worker close during OPEN state completes cleanly (integration)**
```typescript
it('close() during OPEN state resolves without waiting for duration', async () => {
  // Trigger OPEN with duration: 60000; close immediately; verify resolves < 2000ms
});
```

**9. Stalled jobs do not increment failure counter (integration)**
```typescript
it('stalled jobs do not contribute to circuit breaker failure count', async () => {
  // Configure threshold: 2; cause 1 stall; then 1 failure
  // Circuit should still be CLOSED (stall not counted)
});
```

**10. Invalid circuitBreaker config throws on Worker construction (unit)**
```typescript
it('throws synchronously for invalid circuitBreaker options', () => {
  expect(() => new Worker(queueName, NoopProc, {
    connection, prefix,
    circuitBreaker: { threshold: -1, duration: 1000 },
  })).toThrow();
});
```
