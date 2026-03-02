--[[
  Replay a job from the dead letter queue back to its source queue.

  Input:
    KEYS[1] DLQ job hash key
    KEYS[2] DLQ waiting list key
    KEYS[3] source queue waiting list key
    KEYS[4] source queue ID counter key

    ARGV[1] DLQ job id
    ARGV[2] source queue prefix
    ARGV[3] timestamp

  Output:
    New job ID (string) on success
   -1 - Job not found in DLQ.

  Events:
    - 'waiting' on source queue events stream
]]
local rcall = redis.call

-- TODO: Implement in features pass
return -1
