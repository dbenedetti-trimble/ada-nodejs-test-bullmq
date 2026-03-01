--[[
  Atomically moves a terminally-failed job from the source queue's active list
  to the dead letter queue's waiting list, preserving full failure metadata.

  A job reaches this script only when:
    - retries are exhausted (attemptsMade >= maxAttempts), OR
    - the processor threw an UnrecoverableError.

  The source queue's failed sorted set is NOT written; the DLQ waiting list
  receives the job instead.

    Input:
      KEYS[1]  sourceActive       - source queue active list
      KEYS[2]  sourceJobHash      - source queue job hash  (bull:{queue}:{jobId})
      KEYS[3]  sourceEvents       - source queue events stream
      KEYS[4]  dlqWait            - DLQ queue waiting list (bull:{dlq}:wait)
      KEYS[5]  dlqJobHash         - DLQ queue job hash     (bull:{dlq}:{dlqJobId})
      KEYS[6]  dlqEvents          - DLQ queue events stream
      KEYS[7]  sourceMeta         - source queue meta key  (bull:{queue}:meta)

      ARGV[1]  jobId              - source job ID
      ARGV[2]  dlqJobId           - pre-generated UUID for the new DLQ job
      ARGV[3]  dlqMeta            - JSON-encoded DeadLetterMetadata
      ARGV[4]  timestamp          - current timestamp (ms, as string)
      ARGV[5]  removeOnFail       - JSON-encoded removeOnFail option (or empty)
      ARGV[6]  queueKeyPrefix     - key prefix for the source queue (e.g. "bull:payments:")
      ARGV[7]  dlqQueueName       - DLQ queue name string

    Output:
      dlqJobId string on success
      -1 if the source job hash does not exist
      -3 if the job is not found in the source active list

    Events emitted:
      source events stream: 'deadLettered' { jobId, deadLetterQueue, failedReason }
      DLQ events stream:    'waiting'      { jobId }
]]

-- TODO(features): implement full atomic logic:
--   1. LREM source active list
--   2. HGETALL source job hash
--   3. Construct DLQ job hash fields (embed _dlqMeta into data)
--   4. HSET DLQ job hash
--   5. LPUSH DLQ wait list
--   6. XADD source events 'deadLettered'
--   7. XADD DLQ events 'waiting'
--   8. Conditionally DEL / trim source job hash per removeOnFail

return ARGV[2]
