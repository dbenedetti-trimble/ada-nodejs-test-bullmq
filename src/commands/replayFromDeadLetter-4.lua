--[[
  Replay a job from the DLQ back to its source queue's wait list.
  Reads the DLQ job, creates a new job in the source queue, removes from DLQ.

  Input:
    KEYS[1]  DLQ job hash key
    KEYS[2]  DLQ wait key
    KEYS[3]  source wait key
    KEYS[4]  source job hash key (for the new job)

    ARGV[1]  DLQ job id
    ARGV[2]  new job id (UUID for the replayed job)
    ARGV[3]  timestamp (ms)
    ARGV[4]  msgpacked job data (original, without _dlqMeta)
    ARGV[5]  job name
    ARGV[6]  msgpacked opts (original opts)
    ARGV[7]  source job hash key prefix (to construct events key)

  Output:
    newJobId  - the new job ID in the source queue
    -1        - DLQ job not found
]]

-- TODO(features): implement atomic DLQ → source queue replay
-- Stub: return placeholder new job id
local rcall = redis.call

local dlqJobId = ARGV[1]
local newJobId = ARGV[2]

-- Verify DLQ job exists
local exists = rcall('EXISTS', KEYS[1])
if exists == 0 then
  return -1
end

-- Create new job in source queue
rcall('HSET', KEYS[4],
  'name', ARGV[5],
  'data', ARGV[4],
  'opts', ARGV[6],
  'timestamp', ARGV[3],
  'attemptsMade', 0
)

-- Add to source wait list
rcall('LPUSH', KEYS[3], newJobId)

-- Remove DLQ job hash
rcall('DEL', KEYS[1])

-- Remove from DLQ wait list
rcall('LREM', KEYS[2], -1, dlqJobId)

return newJobId
