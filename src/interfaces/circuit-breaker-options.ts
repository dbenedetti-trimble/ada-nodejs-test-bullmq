export interface CircuitBreakerOptions {
  /**
   * Number of consecutive failures before opening the circuit.
   */
  threshold: number;

  /**
   * Time in ms to stay OPEN before transitioning to HALF_OPEN.
   */
  duration: number;

  /**
   * Number of test jobs to allow through in HALF_OPEN state.
   * @defaultValue 1
   */
  halfOpenMaxAttempts?: number;
}
