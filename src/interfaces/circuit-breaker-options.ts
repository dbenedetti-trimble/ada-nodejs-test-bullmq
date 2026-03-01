/**
 * Configuration options for the Worker circuit breaker.
 *
 * @see {@link https://docs.bullmq.io/guide/workers/circuit-breaker}
 */
export interface CircuitBreakerOptions {
  /**
   * Number of consecutive job failures required to open (trip) the circuit.
   * Must be a positive integer.
   */
  threshold: number;

  /**
   * Time in milliseconds the circuit stays OPEN before transitioning to
   * HALF_OPEN and allowing a test job through.
   * Must be a positive integer.
   */
  duration: number;

  /**
   * Number of test jobs allowed through while the circuit is HALF_OPEN.
   * A successful test job closes the circuit; a failure re-opens it.
   * @defaultValue 1
   */
  halfOpenMaxAttempts?: number;
}
