/**
 * Configuration options for the Worker circuit breaker.
 *
 * @see {@link https://docs.bullmq.io/guide/workers/circuit-breaker}
 */
export interface CircuitBreakerOptions {
  /**
   * Number of consecutive job failures required to open (trip) the circuit.
   * Must be a positive integer (no decimals allowed).
   */
  threshold: number;

  /**
   * Time in milliseconds the circuit stays OPEN before transitioning to
   * HALF_OPEN and allowing a test job through.
   * Must be a positive integer (no decimals allowed).
   */
  duration: number;

  /**
   * Number of test jobs allowed through while the circuit is HALF_OPEN.
   * A successful test job closes the circuit; a failure re-opens it.
   * Must be a positive integer if provided (no decimals allowed).
   * @defaultValue 1
   */
  halfOpenMaxAttempts?: number;
}
