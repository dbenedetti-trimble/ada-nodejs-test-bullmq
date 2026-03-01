import { CircuitBreakerOptions } from '../interfaces/circuit-breaker-options';
import { CircuitBreakerState } from '../enums/circuit-breaker-state';

/**
 * Self-contained circuit breaker state machine.
 *
 * States:
 *  CLOSED    — normal operation, jobs are fetched and processed.
 *  OPEN      — circuit tripped, job fetching is paused for `duration` ms.
 *  HALF_OPEN — testing recovery; up to `halfOpenMaxAttempts` test jobs are allowed.
 *
 * The Worker owns event emission; CircuitBreaker only manages state transitions
 * and calls the provided `onTransition` callback so it stays decoupled.
 */
export class CircuitBreaker {
  private state: CircuitBreakerState = CircuitBreakerState.CLOSED;
  private failureCount = 0;
  private halfOpenAttempts = 0;
  private durationTimer: ReturnType<typeof setTimeout> | undefined;
  private closed = false;

  private readonly halfOpenMaxAttempts: number;

  constructor(private readonly opts: CircuitBreakerOptions) {
    this.halfOpenMaxAttempts = opts.halfOpenMaxAttempts ?? 1;
  }

  getState(): CircuitBreakerState {
    return this.state;
  }

  /**
   * Returns true if the circuit should allow a job to be fetched.
   *
   * CLOSED   → always true
   * OPEN     → always false
   * HALF_OPEN → true only while fewer than halfOpenMaxAttempts jobs have been dispatched
   */
  shouldAllowJob(): boolean {
    switch (this.state) {
      case CircuitBreakerState.CLOSED:
        return true;
      case CircuitBreakerState.OPEN:
        return false;
      case CircuitBreakerState.HALF_OPEN:
        if (this.halfOpenAttempts < this.halfOpenMaxAttempts) {
          this.halfOpenAttempts++;
          return true;
        }
        return false;
    }
  }

  /**
   * Record a successful job completion.
   * In CLOSED: resets failure counter.
   * In HALF_OPEN: increments test-job counter; transitions to CLOSED when threshold met.
   *
   * @returns the new state after recording
   */
  recordSuccess(_jobId: string): CircuitBreakerState {
    if (this.state === CircuitBreakerState.CLOSED) {
      this.failureCount = 0;
    } else if (this.state === CircuitBreakerState.HALF_OPEN) {
      if (this.halfOpenAttempts >= this.halfOpenMaxAttempts) {
        this.state = CircuitBreakerState.CLOSED;
        this.failureCount = 0;
        this.halfOpenAttempts = 0;
        clearTimeout(this.durationTimer);
        this.durationTimer = undefined;
      }
    }
    return this.state;
  }

  /**
   * Record a failed job.
   * In CLOSED: increments failure counter; transitions to OPEN at threshold.
   * In HALF_OPEN: transitions back to OPEN, clearing the half-open counter.
   *
   * @returns the new state after recording
   */
  recordFailure(_jobId?: string): CircuitBreakerState {
    if (this.state === CircuitBreakerState.CLOSED) {
      this.failureCount++;
      if (this.failureCount >= this.opts.threshold) {
        this.state = CircuitBreakerState.OPEN;
      }
    } else if (this.state === CircuitBreakerState.HALF_OPEN) {
      this.halfOpenAttempts = 0;
      this.state = CircuitBreakerState.OPEN;
    }
    return this.state;
  }

  /**
   * Starts (or restarts) the OPEN→HALF_OPEN duration timer.
   * Calls `onExpiry` when the timer fires.
   */
  startDurationTimer(onExpiry: () => void): void {
    clearTimeout(this.durationTimer);
    if (!this.closed) {
      this.durationTimer = setTimeout(onExpiry, this.opts.duration);
    }
  }

  /**
   * Transitions state from OPEN to HALF_OPEN.
   * Called by the Worker after the duration timer fires.
   */
  transitionToHalfOpen(): void {
    this.state = CircuitBreakerState.HALF_OPEN;
    this.halfOpenAttempts = 0;
  }

  /**
   * Clears the duration timer and marks the circuit breaker as closed.
   * Called by Worker.close() to allow clean shutdown.
   */
  close(): void {
    this.closed = true;
    clearTimeout(this.durationTimer);
    this.durationTimer = undefined;
  }
}
