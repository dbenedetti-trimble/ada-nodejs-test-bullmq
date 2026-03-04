import { CircuitBreakerOptions } from '../interfaces/circuit-breaker-options';
import { CircuitBreakerState } from '../enums/circuit-breaker-state';

export interface CircuitBreakerOpenPayload {
  failures: number;
  threshold: number;
}

export interface CircuitBreakerClosedPayload {
  testJobId: string;
}

export type CircuitBreakerTransition =
  | { transition?: undefined; payload?: undefined }
  | {
      transition: typeof CircuitBreakerState.OPEN;
      payload: CircuitBreakerOpenPayload;
    }
  | {
      transition: typeof CircuitBreakerState.CLOSED;
      payload: CircuitBreakerClosedPayload;
    };

export class CircuitBreaker {
  private state: CircuitBreakerState = CircuitBreakerState.CLOSED;
  private failureCount = 0;
  private halfOpenAttempts = 0;
  private durationTimer?: ReturnType<typeof setTimeout>;
  private halfOpenResolve?: () => void;
  private readonly halfOpenMaxAttempts: number;

  constructor(private opts: CircuitBreakerOptions) {
    if (!Number.isInteger(opts.threshold) || opts.threshold <= 0) {
      throw new Error('CircuitBreaker: threshold must be a positive integer');
    }
    if (!Number.isInteger(opts.duration) || opts.duration <= 0) {
      throw new Error('CircuitBreaker: duration must be a positive integer');
    }
    if (
      opts.halfOpenMaxAttempts !== undefined &&
      (!Number.isInteger(opts.halfOpenMaxAttempts) ||
        opts.halfOpenMaxAttempts <= 0)
    ) {
      throw new Error(
        'CircuitBreaker: halfOpenMaxAttempts must be a positive integer',
      );
    }
    this.halfOpenMaxAttempts = opts.halfOpenMaxAttempts ?? 1;
  }

  getState(): CircuitBreakerState {
    return this.state;
  }

  shouldAllowJob(): boolean {
    if (this.state === CircuitBreakerState.OPEN) {
      return false;
    }
    if (this.state === CircuitBreakerState.HALF_OPEN) {
      return this.halfOpenAttempts < this.halfOpenMaxAttempts;
    }
    return true;
  }

  recordJobDispatched(): void {
    if (this.state === CircuitBreakerState.HALF_OPEN) {
      this.halfOpenAttempts++;
    }
  }

  recordSuccess(jobId: string): CircuitBreakerTransition {
    if (this.state === CircuitBreakerState.HALF_OPEN) {
      this.halfOpenAttempts = 0;
      this.failureCount = 0;
      this.state = CircuitBreakerState.CLOSED;
      return {
        transition: CircuitBreakerState.CLOSED,
        payload: { testJobId: jobId },
      };
    }
    this.failureCount = 0;
    return {};
  }

  recordFailure(): CircuitBreakerTransition {
    if (this.state === CircuitBreakerState.HALF_OPEN) {
      this.halfOpenAttempts = 0;
      this.failureCount = 1;
      return this.transitionToOpen();
    }

    this.failureCount++;
    if (this.failureCount >= this.opts.threshold) {
      return this.transitionToOpen();
    }

    return {};
  }

  waitForHalfOpen(): Promise<void> {
    return new Promise<void>(resolve => {
      this.halfOpenResolve = resolve;
      this.durationTimer = setTimeout(() => {
        this.state = CircuitBreakerState.HALF_OPEN;
        this.halfOpenAttempts = 0;
        this.durationTimer = undefined;
        const resolveFn = this.halfOpenResolve;
        this.halfOpenResolve = undefined;
        resolveFn?.();
      }, this.opts.duration);
    });
  }

  interruptWait(): void {
    if (this.halfOpenResolve) {
      this.halfOpenResolve();
      this.halfOpenResolve = undefined;
    }
  }

  close(): void {
    if (this.durationTimer) {
      clearTimeout(this.durationTimer);
      this.durationTimer = undefined;
    }
    this.interruptWait();
  }

  private transitionToOpen(): CircuitBreakerTransition {
    const failures = this.failureCount;
    this.state = CircuitBreakerState.OPEN;
    this.failureCount = 0;
    return {
      transition: CircuitBreakerState.OPEN,
      payload: { failures, threshold: this.opts.threshold },
    };
  }
}
