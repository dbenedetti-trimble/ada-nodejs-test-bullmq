import { CircuitBreakerOptions } from '../interfaces/circuit-breaker-options';
import { CircuitBreakerState } from '../enums/circuit-breaker-state';

export interface CircuitBreakerTransition {
  state: CircuitBreakerState;
  previousState: CircuitBreakerState;
  failures?: number;
}

export class CircuitBreaker {
  private state: CircuitBreakerState = CircuitBreakerState.CLOSED;
  private failureCount = 0;
  private halfOpenAttempts = 0;
  private durationTimer?: ReturnType<typeof setTimeout>;
  private waitResolve?: () => void;
  private waitPromise?: Promise<void>;
  private closed = false;

  constructor(private opts: CircuitBreakerOptions) {
    if (!opts || typeof opts.threshold !== 'number' || opts.threshold <= 0) {
      throw new Error('circuitBreaker.threshold must be a positive integer');
    }
    if (typeof opts.duration !== 'number' || opts.duration <= 0) {
      throw new Error('circuitBreaker.duration must be a positive integer');
    }
    if (
      opts.halfOpenMaxAttempts !== undefined &&
      (typeof opts.halfOpenMaxAttempts !== 'number' ||
        opts.halfOpenMaxAttempts <= 0)
    ) {
      throw new Error(
        'circuitBreaker.halfOpenMaxAttempts must be a positive integer',
      );
    }
  }

  getState(): CircuitBreakerState {
    return this.state;
  }

  shouldAllowJob(): boolean {
    switch (this.state) {
      case CircuitBreakerState.CLOSED:
        return true;
      case CircuitBreakerState.OPEN:
        return false;
      case CircuitBreakerState.HALF_OPEN: {
        const maxAttempts = this.opts.halfOpenMaxAttempts ?? 1;
        return this.halfOpenAttempts < maxAttempts;
      }
    }
  }

  recordSuccess(): CircuitBreakerTransition | undefined {
    if (this.closed) {
      return;
    }

    const previousState = this.state;

    if (this.state === CircuitBreakerState.HALF_OPEN) {
      this.state = CircuitBreakerState.CLOSED;
      this.failureCount = 0;
      this.halfOpenAttempts = 0;
      return { state: CircuitBreakerState.CLOSED, previousState };
    }

    this.failureCount = 0;
    return undefined;
  }

  recordFailure(): CircuitBreakerTransition | undefined {
    if (this.closed) {
      return;
    }

    const previousState = this.state;

    if (this.state === CircuitBreakerState.HALF_OPEN) {
      this.halfOpenAttempts = 0;
      return this.transitionToOpen(previousState);
    }

    this.failureCount++;
    if (this.failureCount >= this.opts.threshold) {
      return this.transitionToOpen(previousState);
    }

    return undefined;
  }

  /**
   * Returns a promise that resolves when the circuit transitions out of OPEN.
   * The promise is also resolved when close() is called.
   */
  waitForHalfOpen(): Promise<void> {
    if (this.state !== CircuitBreakerState.OPEN) {
      return Promise.resolve();
    }
    if (!this.waitPromise) {
      this.waitPromise = new Promise<void>(resolve => {
        this.waitResolve = resolve;
      });
    }
    return this.waitPromise;
  }

  /**
   * Track that a job was fetched during HALF_OPEN state.
   */
  trackHalfOpenAttempt(): void {
    if (this.state === CircuitBreakerState.HALF_OPEN) {
      this.halfOpenAttempts++;
    }
  }

  close(): void {
    this.closed = true;
    if (this.durationTimer) {
      clearTimeout(this.durationTimer);
      this.durationTimer = undefined;
    }
    if (this.waitResolve) {
      this.waitResolve();
      this.waitResolve = undefined;
      this.waitPromise = undefined;
    }
  }

  private transitionToOpen(
    previousState: CircuitBreakerState,
  ): CircuitBreakerTransition {
    this.state = CircuitBreakerState.OPEN;
    this.startDurationTimer();
    return {
      state: CircuitBreakerState.OPEN,
      previousState,
      failures: this.failureCount,
    };
  }

  private startDurationTimer(): void {
    if (this.durationTimer) {
      clearTimeout(this.durationTimer);
    }

    this.durationTimer = setTimeout(() => {
      if (this.closed) {
        return;
      }
      this.durationTimer = undefined;
      this.state = CircuitBreakerState.HALF_OPEN;
      this.halfOpenAttempts = 0;

      if (this.waitResolve) {
        this.waitResolve();
        this.waitResolve = undefined;
        this.waitPromise = undefined;
      }
    }, this.opts.duration);

    // Allow the timer to not prevent Node.js from exiting
    if (this.durationTimer && typeof this.durationTimer === 'object') {
      this.durationTimer.unref();
    }
  }
}
