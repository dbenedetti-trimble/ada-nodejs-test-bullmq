--[[
  Move job from active to a dead letter queue on terminal failure.

  Input:
    KEYS[1] source queue active list key
    KEYS[2] source queue job hash key
    KEYS[3] source queue events stream key
    KEYS[4] DLQ queue waiting list key
    KEYS[5] DLQ queue job hash key (new job)
    KEYS[6] DLQ queue events stream key
    KEYS[7] DLQ queue meta key

    ARGV[1] source queue prefix
    ARGV[2] job id
    ARGV[3] DLQ job id
    ARGV[4] DLQ queue name
    ARGV[5] timestamp
    ARGV[6] failed reason
    ARGV[7] token
    ARGV[8] packed opts (removeOnFail, maxMetricsSize, etc.)

  Output:
    0 - OK
   -1 - Missing job.
   -2 - Missing lock.
   -3 - Job not in active set.

  Events:
    - 'deadLettered' on source events stream
    - 'waiting' on DLQ events stream
]]
local rcall = redis.call

-- TODO: Implement in features pass
return 0
