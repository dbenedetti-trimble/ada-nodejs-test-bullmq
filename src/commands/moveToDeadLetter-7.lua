--[[
  Move job from source queue's active list to DLQ queue's waiting list on terminal failure.
  Atomic: removes from source active, creates DLQ job hash with _dlqMeta, pushes to DLQ wait,
  emits events on both queues, and optionally cleans up source job hash per removeOnFail.

  NOTE (Redis Cluster): All KEYS must hash to the same slot. Use matching hash tags on both
  the source queue name and the DLQ queue name (e.g. {payments} and {payments}-dlq).

    Input:
      KEYS[1]  source active list key
      KEYS[2]  source job hash key
      KEYS[3]  source events stream key
      KEYS[4]  DLQ wait list key
      KEYS[5]  DLQ job hash key
      KEYS[6]  DLQ events stream key
      KEYS[7]  DLQ meta key

      ARGV[1]  source job ID
      ARGV[2]  DLQ queue name
      ARGV[3]  DLQ job ID (new UUID)
      ARGV[4]  packed metadata (msgpack: { sourceQueue, failedReason, stacktrace, attemptsMade, deadLetteredAt, originalTimestamp, originalOpts })
      ARGV[5]  timestamp (ms)
      ARGV[6]  removeOnFail flag ('1' = remove source job hash, '' = keep)

    Output:
      DLQ job ID string on success
      -1  source job does not exist
      -3  job not in active set

    Events:
      source events stream: 'deadLettered' { jobId, deadLetterQueue }
      DLQ events stream:    'waiting'      { jobId }
]]
local rcall = redis.call

--- Includes
--- @include "includes/trimEvents"

-- TODO: implement business logic in features pass
-- Stub: return placeholder to allow TypeScript compile and test scaffolding
return ARGV[3]
