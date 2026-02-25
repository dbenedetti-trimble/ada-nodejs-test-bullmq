# BullMQ Test Execution Guide

## Running Tests

### Prerequisites
Start Redis before running any tests:
```bash
docker-compose up -d
```

### Run All Tests (Recommended)
```bash
yarn test
# Runs: pretest (Lua script transform) + vitest
```

### Unit/Integration Tests Only
```bash
yarn test:vitest                  # Run Vitest directly
yarn test:watch                   # Watch mode for development
yarn test:vitest:ui               # Vitest UI (browser-based)
```

### Specific Test File
```bash
npx vitest tests/bulk.test.ts     # Run single test file
npx vitest tests/events.test.ts   # Run events tests
npx vitest --reporter=verbose     # Verbose output
```

### Coverage
```bash
yarn coverage                     # Run tests with coverage report
```

### Coverage Thresholds
- **Lines**: 80%
- **Functions**: 80%
- **Branches**: 70%
- **Statements**: 80%

## Test Data

### Test Data Setup
- Tests use unique queue names via `test-${v4()}` (UUID-based)
- Redis connection established in `beforeAll` hooks
- Queue instances created in `beforeEach` hooks
- No dedicated test fixtures directory; data is inline

### Test Data Cleanup
- Cleanup in `afterEach` hooks: close queues, remove all queue data
- Connection cleanup in `afterAll` hooks: close Redis connection
- `removeAllQueueData()` utility clears all Redis keys for a queue

### Environment Variables for Testing
- `REDIS_HOST`: Redis host (default: `localhost`)
- `BULLMQ_TEST_PREFIX`: Queue prefix (default: `bull`)
- `CI`: Set to `true` in CI for longer timeouts

## Test Patterns

### Standard Test Structure
```typescript
import { default as IORedis } from 'ioredis';
import { describe, beforeEach, afterEach, beforeAll, afterAll, it, expect } from 'vitest';
import { v4 } from 'uuid';
import { Queue, Worker, Job } from '../src/classes';
import { removeAllQueueData, delay } from '../src/utils';

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

  afterAll(async () => {
    await connection.quit();
  });

  it('should do something', async () => {
    // Arrange, Act, Assert
  });
});
```

### Worker Processing Pattern
```typescript
it('should process jobs', async () => {
  let processor;
  const processing = new Promise<void>(
    resolve =>
      (processor = async (job: Job) => {
        expect(job.data.foo).toBe('bar');
        resolve();
      }),
  );

  const worker = new Worker(queueName, processor, { connection, prefix });
  await worker.waitUntilReady();

  await queue.add('test', { foo: 'bar' });
  await processing;

  await worker.close();
});
```

### Event Listening Pattern
```typescript
it('should emit events', async () => {
  const queueEvents = new QueueEvents(queueName, { connection, prefix });
  await queueEvents.waitUntilReady();

  const completed = new Promise<void>((resolve) => {
    queueEvents.on('completed', ({ jobId }) => {
      expect(jobId).toBeTruthy();
      resolve();
    });
  });

  const worker = new Worker(queueName, async () => 'done', { connection, prefix });
  await worker.waitUntilReady();

  await queue.add('test', { data: 'value' });
  await completed;

  await worker.close();
  await queueEvents.close();
});
```

## Real Dependencies vs Mocks

### When to Use Real Dependencies

#### Use Real (Preferred)
- **Redis**: All tests use real Redis (via docker-compose)
- **Queue/Worker/Job**: Always use real BullMQ classes
- **Lua Scripts**: Always test against real Redis execution
- **Event Emitters**: Use real QueueEvents

#### Example: Real Integration Test
```typescript
it('real integration test', async () => {
  const worker = new Worker(queueName, async (job) => {
    return job.data.value * 2;
  }, { connection, prefix });
  await worker.waitUntilReady();

  const job = await queue.add('test', { value: 21 });
  const result = await job.waitUntilFinished(queueEvents);

  expect(result).toBe(42);
  await worker.close();
});
```

### When to Mock/Stub

#### Mock These
- **External HTTP APIs**: Third-party services
- **File System Operations**: If not core to the test
- **Timers**: Use Sinon fake timers for time-dependent tests
- **Complex Callbacks**: Use Sinon stubs for verification

#### Example: Using Sinon Stubs
```typescript
import * as sinon from 'sinon';

it('uses stub for verification', async () => {
  const spy = sinon.spy();

  const worker = new Worker(queueName, async (job) => {
    spy(job.data);
    return 'done';
  }, { connection, prefix });
  await worker.waitUntilReady();

  await queue.add('test', { key: 'value' });
  await delay(500);

  expect(spy.calledOnce).toBe(true);
  expect(spy.firstCall.args[0]).toEqual({ key: 'value' });

  await worker.close();
});
```

### Testing Strategies by Component

| Component Type | Strategy | Tools |
|----------------|----------|-------|
| **Queue Operations** | Real Redis | Queue class, IORedis |
| **Worker Processing** | Real Redis + Promise resolution | Worker class, Promise patterns |
| **Job Lifecycle** | Real end-to-end | Queue + Worker + QueueEvents |
| **Lua Scripts** | Real Redis execution | Scripts class via Queue/Worker |
| **Error Handling** | Real throws + catches | UnrecoverableError, DelayedError |
| **Timers/Delays** | Sinon fake timers or real delay | sinon.useFakeTimers(), delay() |
| **External APIs** | Mock/stub | sinon.stub() |

## Test Quality Principles & Anti-Patterns

### Principles to Follow

#### 1. Test Behavior, Not Implementation
- **Good**: Test job lifecycle (add -> process -> complete)
- **Bad**: Test internal Redis key structure directly

#### 2. Validate Acceptance Criteria Explicitly
- Write tests that directly validate PRD requirements
- Use descriptive test names matching acceptance criteria

#### 3. Use Real Redis
- All BullMQ tests require real Redis (no mocking Redis)
- Use `docker-compose up -d` before running tests
- Tests verify actual atomic Lua script behavior

#### 4. Cover Positive and Negative Cases
```typescript
describe('feature', () => {
  it('should succeed with valid input', async () => { ... });
  it('should fail gracefully with invalid input', async () => { ... });
  it('should handle edge case', async () => { ... });
});
```

#### 5. Clean Up Resources
- Always close Workers, Queues, QueueEvents in afterEach
- Use `removeAllQueueData()` to clean Redis state
- Close Redis connection in afterAll

### Anti-Patterns to Avoid

#### 1. Mocking Redis
```typescript
// BAD: Mocking Redis client
const mockRedis = { get: vi.fn(), set: vi.fn() };

// GOOD: Use real Redis
const connection = new IORedis(redisHost, { maxRetriesPerRequest: null });
```

#### 2. Testing Internal Redis Keys
```typescript
// BAD: Testing internal implementation
const keys = await connection.keys('bull:test:*');
expect(keys.length).toBe(3);

// GOOD: Testing through public API
const counts = await queue.getJobCounts('waiting', 'active', 'completed');
expect(counts.completed).toBe(1);
```

#### 3. Flaky Timing-Dependent Tests
```typescript
// BAD: Fixed timeout that may be too short
await new Promise(resolve => setTimeout(resolve, 100));
expect(result).toBeTruthy();

// GOOD: Use Promise-based resolution
const processing = new Promise<void>(resolve => {
  worker.on('completed', () => resolve());
});
await processing;
```

#### 4. Not Cleaning Up Workers
```typescript
// BAD: Forgetting to close worker
const worker = new Worker(queueName, processor, { connection, prefix });
// ... test ... (worker left running!)

// GOOD: Always clean up
afterEach(async () => {
  await worker.close();
});
```

## Execution Guidance

### Local Development
1. Start Redis: `docker-compose up -d`
2. Install dependencies: `yarn install`
3. Run pretest: `yarn pretest` (required after Lua script changes)
4. Run tests: `yarn test`
5. Use watch mode: `yarn test:watch`

### Before Committing
```bash
yarn lint                         # Check code style
yarn prettier                     # Format code
yarn test                         # Run all tests
yarn tsc:all                      # Verify TypeScript compilation
```

### Important Notes
- Tests run sequentially (`--no-file-parallelism`) because they share Redis state
- Full test suite takes several minutes
- Individual test files can be run in isolation for faster iteration
- Always run `yarn pretest` after modifying Lua scripts in `src/commands/`

---

**Test Framework**: Vitest 4.0.18
**Mocking Library**: Sinon 19.0.2
**Assertion Style**: Vitest `expect` API
**Redis Client**: ioredis 5.9.3

**Last Updated**: 2026-02-25
**BullMQ Version**: 5.70.1
**Protocol Version**: 2.16.0
