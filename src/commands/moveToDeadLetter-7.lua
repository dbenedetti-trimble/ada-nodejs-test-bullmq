--[[
  Atomically move a job from the source queue's active list to the DLQ queue's
  waiting list on terminal failure.

  NOTE (Redis Cluster): All keys must hash to the same slot. Source and DLQ
  queue names must share the same hash tag (e.g. '{payments}' and '{payments}-dlq').

  Input:
    KEYS[1]  source active list key        ({prefix}:{sourceQueue}:active)
    KEYS[2]  source job hash key           ({prefix}:{sourceQueue}:{jobId})
    KEYS[3]  source events stream key      ({prefix}:{sourceQueue}:events)
    KEYS[4]  DLQ waiting list key          ({prefix}:{dlqQueue}:wait)
    KEYS[5]  DLQ job hash key              ({prefix}:{dlqQueue}:{newJobId})
    KEYS[6]  DLQ events stream key         ({prefix}:{dlqQueue}:events)
    KEYS[7]  DLQ meta key                  ({prefix}:{dlqQueue}:meta)

    ARGV[1]  jobId
    ARGV[2]  timestamp (ms epoch)
    ARGV[3]  dlqJobId (new job ID for the DLQ job)
    ARGV[4]  packed opts (token, removeOnFail)
    ARGV[5]  packed dlqMeta (sourceQueue, failedReason, stacktrace, attemptsMade,
                             deadLetteredAt, originalTimestamp, originalOpts)

  Output:
    dlqJobId on success
    -1 Missing key (job not found)
    -3 Job not in active list (lock expired)

  Events:
    deadLettered (on source events stream)
    waiting (on DLQ events stream)
]]

local rcall = redis.call

--- @include "includes/trimEvents"
--- @include "includes/removeJobKeys"

-- TODO (features pass): implement atomic DLQ movement logic
-- Placeholder: return error code until implemented
return -1
