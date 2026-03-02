export type GroupState =
  | 'PENDING'
  | 'ACTIVE'
  | 'COMPENSATING'
  | 'COMPLETED'
  | 'FAILED'
  | 'FAILED_COMPENSATION';

export type GroupJobStatus =
  | 'pending'
  | 'active'
  | 'completed'
  | 'failed'
  | 'cancelled';
