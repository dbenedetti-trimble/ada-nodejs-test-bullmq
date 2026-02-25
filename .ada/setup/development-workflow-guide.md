# BullMQ Development Workflow Guide

## Repository Structure

### Core Directories
- **`src/`** - TypeScript source files
  - `src/classes/` - Core classes: Queue, Worker, Job, FlowProducer, Scripts, etc.
  - `src/classes/errors/` - Custom error types (DelayedError, RateLimitError, etc.)
  - `src/commands/` - ~50 Lua scripts for atomic Redis operations
  - `src/commands/includes/` - Shared Lua modules
  - `src/enums/` - Job states, metrics, telemetry attributes
  - `src/interfaces/` - TypeScript interfaces (30+ files)
  - `src/types/` - Type aliases
  - `src/utils/` - Helper utilities
- **`tests/`** - Vitest integration tests (require Redis running)
- **`python/`** - Python implementation (out of scope for Node.js PRDs)
- **`rawScripts/`** - Generated raw Lua scripts (from `yarn generate:raw:scripts`)
- **`dist/`** - Compiled JavaScript output

### Key Files
- **`src/classes/queue.ts`** - Queue class for adding and managing jobs
- **`src/classes/worker.ts`** (~41KB) - Worker class for processing jobs
- **`src/classes/job.ts`** (~44KB) - Job class representing individual jobs
- **`src/classes/scripts.ts`** (~46KB) - Bridge between TypeScript and Lua scripts
- **`src/classes/flow-producer.ts`** - FlowProducer for job dependencies
- **`docker-compose.yml`** - Redis 7 (+ optional cluster/dragonfly configs)
- **`package.json`** - Project metadata and scripts
- **`vitest.config.ts`** - Vitest test configuration
- **`tsconfig.json`** - TypeScript compiler configuration

## Frameworks & Dependencies

### Core Framework
- **BullMQ** - Premium message queue for Node.js based on Redis
- **TypeScript 5.9.3** - Language and type system
- **Node.js** - Runtime environment (types: @types/node 18.19.130)

### Key Production Dependencies
- **ioredis** (5.9.3) - Redis client for Node.js
- **glob** (8.1.0) - File globbing utility
- **msgpackr** (1.11.0) - MessagePack serialization
- **node-abort-controller** (3.1.1) - AbortController polyfill
- **semver** (7.7.1) - Semantic versioning
- **uuid** (9.0.1) - UUID generation
- **cron-parser** (4.9.0) - Cron expression parsing
- **lodash** (4.17.21) - Utility functions

### Development Tools
- **Vitest** (4.0.18) - Test framework
- **ESLint** (9.39.2) - Code linting
- **Prettier** (3.8.1) - Code formatting
- **TypeScript** (5.9.3) - Type checking and compilation
- **Sinon** (19.0.2) - Test mocking/stubbing
- **Husky** - Git hooks
- **lint-staged** - Pre-commit linting
- **commitlint** - Commit message enforcement

## Build System

### Build Tools
- **Yarn** (1.22.22) - Package manager
- **TypeScript Compiler** (tsc) - Compilation
- **Custom Lua script generator** - Transforms Lua command scripts

### Build Scripts
```bash
yarn build                        # Full build: pretest + tsc + copy Lua scripts
yarn tsc:all                      # TypeScript compilation only
yarn pretest                      # Transform Lua command scripts (required before testing)
yarn generate:raw:scripts         # Generate raw Lua scripts
```

### Build Process
1. **Pretest**: `yarn pretest` transforms Lua command scripts into loadable format
2. **TypeScript Compilation**: `yarn tsc:all` compiles all TypeScript files
3. **Lua Script Copy**: Compiled Lua scripts are copied to `dist/`

### Important Build Notes
- **Always run `yarn pretest` after modifying Lua scripts** - Tests will fail with script hash mismatches otherwise
- Generated Lua scripts use EVALSHA for performance; the pretest step computes SHA hashes
- Shared Lua modules in `src/commands/includes/` are inlined during the transform step

## Dependency Management

### Install All Dependencies
```bash
yarn install                      # Install all dependencies
```

### Add New Dependencies

#### Production Dependency
```bash
yarn add <package-name>
yarn add <package-name>@<version>
```

#### Development Dependency
```bash
yarn add -D <package-name>
yarn add -D <package-name>@<version>
```

### Update Dependencies
```bash
yarn upgrade                      # Update all dependencies within semver ranges
yarn upgrade <package-name>       # Update specific package
yarn outdated                     # Check for outdated packages
```

### Remove Dependencies
```bash
yarn remove <package-name>
```

### Dependency Best Practices
- Use caret ranges (^) for stability
- Review `yarn.lock` changes in PRs
- Test thoroughly after dependency updates
- Check compatibility with Node.js versions supported

## Compilation

### TypeScript Compilation
```bash
yarn tsc:all                      # Compile all TypeScript
```

### Lua Script Compilation
```bash
yarn pretest                      # Transform Lua command scripts
yarn generate:raw:scripts         # Generate raw Lua scripts
```

### Build Output
- TypeScript compiles to `dist/` directory
- Lua scripts are copied alongside compiled JS

## Linting & Formatting

### Linting Configuration
- **Tool**: ESLint 9.39.2 with TypeScript support
- **Config File**: `eslint.config.mjs`
- **Style**: Enforced via ESLint + Prettier

### Run Linting
```bash
yarn lint                         # Run ESLint on all files
yarn eslint:fix                   # Auto-fix ESLint issues
```

### Run Formatting
```bash
yarn prettier                     # Format code with Prettier
yarn pretty:quick                 # Quick format staged files
```

### Code Quality Checks
```bash
yarn circular:references          # Check for circular dependencies
yarn lint:staged                  # Lint staged files (pre-commit)
```

### Linting Best Practices
- Run `yarn lint` before committing
- Use editor integration for real-time feedback
- Follow existing code style patterns
- Fix linting errors before submitting PRs

## Static Analysis & Security

### Security Scanning
```bash
yarn audit                        # Check for vulnerabilities (via yarn)
```

### Code Quality
- **ESLint**: Enforces code quality rules
- **TypeScript**: Type checking ensures type safety
- **Circular dependency check**: Prevents circular imports

## Environment Setup

### Required Environment Variables
- `REDIS_HOST`: Redis host for tests (default: `localhost`)
- `BULLMQ_TEST_PREFIX`: Prefix for test queues (default: `bull`)

### Optional Environment Variables
- `CI`: Set to `true` in CI environments for longer timeouts

### Local Development Setup

#### 1. Clone Repository
```bash
git clone https://github.com/dbenedetti-trimble/ada-nodejs-test-bullmq.git
cd ada-nodejs-test-bullmq
```

#### 2. Install Dependencies
```bash
yarn install
```

#### 3. Start Redis
```bash
docker-compose up -d
```

#### 4. Run Tests
```bash
yarn test
```

#### 5. Build
```bash
yarn build
```

### Node.js Version
- Check `package.json` `engines` field for supported versions
- Use **nvm** or **fnm** to manage Node.js versions

### Docker Setup
- **Redis 7** (`redis:7-alpine`) on port 6379 (default)
- **Redis Cluster**: `docker-compose --profile cluster up -d`
- **Redis Cluster with Auth**: `docker-compose --profile cluster-auth up -d`
- **Dragonfly**: `docker-compose --profile dragonfly up -d`

## Additional Notes

### Architecture
- Lua scripts handle all multi-step Redis operations atomically
- `Scripts` class (~46KB) bridges TypeScript and Lua via EVALSHA commands
- Worker uses an async processing loop with lock management and stall detection
- Telemetry interface exists but is abstract (OTel-inspired, not OTel-specific)
- Existing backoff strategies: `fixed` and `exponential` with jitter support

### Testing Philosophy
- Vitest with sequential execution (`--no-file-parallelism`)
- Redis connection required for all tests
- Tests use unique queue names (UUID-based) to avoid conflicts
- Cleanup happens in `afterEach` hooks
- Sinon for mocking, no HTTP server needed
- `yarn pretest` generates compiled Lua scripts from source

### Commit Message Format
This project uses semantic-release with conventional commit format:
- `feat:` - New features
- `fix:` - Bug fixes
- `docs:` - Documentation changes
- `chore:` - Maintenance tasks
- `refactor:` - Code refactoring
- `test:` - Test changes
- `perf:` - Performance improvements

### Multi-Language Repository
BullMQ has Python, Elixir, and PHP implementations alongside Node.js. Only modify TypeScript/Lua code in `src/` and `tests/`. Other language directories are out of scope.

---

**Last Updated**: 2026-02-25
**BullMQ Version**: 5.70.1
**Protocol Version**: 2.16.0
