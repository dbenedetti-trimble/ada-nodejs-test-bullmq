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

