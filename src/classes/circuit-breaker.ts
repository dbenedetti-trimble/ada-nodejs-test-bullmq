import { CircuitBreakerOptions } from '../interfaces/circuit-breaker-options';
import { CircuitBreakerState } from '../enums/circuit-breaker-state';

export type CircuitBreakerTransitionPayload =
  | { state: CircuitBreakerState.OPEN; failures: number; threshold: number }
  | { state: CircuitBreakerState.HALF_OPEN; duration: number }
  | { state: CircuitBreakerState.CLOSED; testJobId: string };

/**
 * Encapsulates the CLOSED → OPEN → HALF_OPEN → CLOSED state machine for the
 * Worker circuit breaker. All state and timer management is local to this
 * instance (no Redis involvement).
 */
export class CircuitBreaker {
  private state: CircuitBreakerState = CircuitBreakerState.CLOSED;
  private failureCount = 0;
  private halfOpenAttemptsLeft = 0;
  private durationTimer?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly opts: Required<CircuitBreakerOptions>,
    private readonly onTransition: (
      payload: CircuitBreakerTransitionPayload,
    ) => void,
  ) {
    this.halfOpenAttemptsLeft = opts.halfOpenMaxAttempts;
  }

  /**
   * Notify the circuit breaker that a job completed successfully.
   * In CLOSED state this resets the failure counter.
   * In HALF_OPEN state this closes the circuit.
   */
  recordSuccess(jobId: string): void {
    if (this.state === CircuitBreakerState.HALF_OPEN) {
      this.clearDurationTimer();
      this.state = CircuitBreakerState.CLOSED;
      this.failureCount = 0;
      this.halfOpenAttemptsLeft = this.opts.halfOpenMaxAttempts;
      this.onTransition({
        state: CircuitBreakerState.CLOSED,
        testJobId: jobId,
      });
    } else if (this.state === CircuitBreakerState.CLOSED) {
      this.failureCount = 0;
    }
  }

  /**
   * Notify the circuit breaker that a job failed.
   * In CLOSED state this increments the failure counter and may open the circuit.
   * In HALF_OPEN state this re-opens the circuit.
   * Stalled jobs must NOT call this method.
   */
  recordFailure(): void {
    if (this.state === CircuitBreakerState.CLOSED) {
      this.failureCount++;
      if (this.failureCount >= this.opts.threshold) {
        this.state = CircuitBreakerState.OPEN;
        this.startDurationTimer();
        this.onTransition({
          state: CircuitBreakerState.OPEN,
          failures: this.failureCount,
          threshold: this.opts.threshold,
        });
      }
    } else if (this.state === CircuitBreakerState.HALF_OPEN) {
      this.state = CircuitBreakerState.OPEN;
      this.halfOpenAttemptsLeft = this.opts.halfOpenMaxAttempts;
      this.startDurationTimer();
      this.onTransition({
        state: CircuitBreakerState.OPEN,
        failures: this.failureCount,
        threshold: this.opts.threshold,
      });
    }
  }

  /**
   * Returns the current circuit breaker state.
   */
  getState(): CircuitBreakerState {
    return this.state;
  }

  /**
   * Returns true when the worker is allowed to fetch and process a job.
   * CLOSED → true, OPEN → false, HALF_OPEN → true up to halfOpenMaxAttempts times.
   */
  shouldAllowJob(): boolean {
    if (this.state === CircuitBreakerState.CLOSED) {
      return true;
    }
    if (this.state === CircuitBreakerState.OPEN) {
      return false;
    }
    // HALF_OPEN: allow up to halfOpenMaxAttempts jobs
    if (this.halfOpenAttemptsLeft > 0) {
      this.halfOpenAttemptsLeft--;
      return true;
    }
    return false;
  }

  /**
   * Clears any pending duration timer. Call from Worker.close() to allow
   * clean shutdown without waiting for the OPEN duration to expire.
   */
  close(): void {
    this.clearDurationTimer();
  }

  private startDurationTimer(): void {
    this.clearDurationTimer();
    this.durationTimer = setTimeout(() => {
      this.durationTimer = undefined;
      this.state = CircuitBreakerState.HALF_OPEN;
      this.halfOpenAttemptsLeft = this.opts.halfOpenMaxAttempts;
      this.onTransition({
        state: CircuitBreakerState.HALF_OPEN,
        duration: this.opts.duration,
      });
    }, this.opts.duration);
  }

  private clearDurationTimer(): void {
    if (this.durationTimer !== undefined) {
      clearTimeout(this.durationTimer);
      this.durationTimer = undefined;
    }
  }
}
