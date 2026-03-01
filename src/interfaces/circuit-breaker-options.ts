export interface CircuitBreakerOptions {
  /**
   * Number of consecutive failures before opening the circuit.
   * Must be a positive integer.
   */
  threshold: number;

  /**
   * Time in milliseconds to keep the circuit OPEN before transitioning to HALF_OPEN.
   * Must be a positive integer.
   */
  duration: number;

  /**
   * Number of test jobs to allow through in HALF_OPEN state before deciding to close.
   * @defaultValue 1
   */
  halfOpenMaxAttempts?: number;
}
