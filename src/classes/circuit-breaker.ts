import { CircuitBreakerOptions } from '../interfaces/circuit-breaker-options';
import { CircuitBreakerState } from '../enums/circuit-breaker-state';

export interface CircuitBreakerTransition {
  transition?: CircuitBreakerState;
  payload?: any;
}

export class CircuitBreaker {
  private state: CircuitBreakerState = CircuitBreakerState.CLOSED;
  private failureCount = 0;
  private halfOpenAttempts = 0;
  private durationTimer?: ReturnType<typeof setTimeout>;
  private halfOpenResolve?: () => void;

  constructor(private opts: CircuitBreakerOptions) {
    // TODO: validate opts in features pass
  }

  getState(): CircuitBreakerState {
    return this.state;
  }

  shouldAllowJob(): boolean {
    // TODO: implement in features pass
    return true;
  }

  recordSuccess(_jobId: string): CircuitBreakerTransition {
    // TODO: implement in features pass
    return {};
  }

  recordFailure(): CircuitBreakerTransition {
    // TODO: implement in features pass
    return {};
  }

  waitForHalfOpen(): Promise<void> {
    // TODO: implement in features pass
    return Promise.resolve();
  }

  close(): void {
    // TODO: implement timer cleanup in features pass
    if (this.durationTimer) {
      clearTimeout(this.durationTimer);
      this.durationTimer = undefined;
    }
    if (this.halfOpenResolve) {
      this.halfOpenResolve();
      this.halfOpenResolve = undefined;
    }
  }
}
