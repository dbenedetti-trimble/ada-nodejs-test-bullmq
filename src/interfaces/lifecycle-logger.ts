export type LifecycleEvent =
  | 'job:added'
  | 'job:active'
  | 'job:completed'
  | 'job:failed'
  | 'job:retrying'
  | 'job:delayed'
  | 'job:stalled'
  | 'job:rate-limited';

export interface LifecycleLogEntry {
  timestamp: number;
  event: LifecycleEvent;
  queue: string;
  jobId?: string;
  jobName?: string;
  attemptsMade?: number;
  duration?: number;
  data?: Record<string, unknown>;
}

export interface LifecycleLogger {
  debug(entry: LifecycleLogEntry): void;
  warn(entry: LifecycleLogEntry): void;
  error(entry: LifecycleLogEntry): void;
}
