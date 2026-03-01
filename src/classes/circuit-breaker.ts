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
  ) {}

  /**
   * Notify the circuit breaker that a job completed successfully.
   * In CLOSED state this resets the failure counter.
   * In HALF_OPEN state this closes the circuit.
   */
  recordSuccess(_jobId: string): void {
    // TODO (features pass): implement CLOSED counter reset and HALF_OPEN → CLOSED transition
    throw new Error('Not implemented');
  }

  /**
   * Notify the circuit breaker that a job failed.
   * In CLOSED state this increments the failure counter and may open the circuit.
   * In HALF_OPEN state this re-opens the circuit.
   * Stalled jobs must NOT call this method.
   */
  recordFailure(): void {
    // TODO (features pass): implement CLOSED threshold check and HALF_OPEN → OPEN transition
    throw new Error('Not implemented');
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
    // TODO (features pass): implement per-state logic
    throw new Error('Not implemented');
  }

  /**
   * Clears any pending duration timer. Call from Worker.close() to allow
   * clean shutdown without waiting for the OPEN duration to expire.
   */
  close(): void {
    if (this.durationTimer !== undefined) {
      clearTimeout(this.durationTimer);
      this.durationTimer = undefined;
    }
  }
}
