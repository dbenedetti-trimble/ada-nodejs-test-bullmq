--[[
  Replay a job from the DLQ back to its source queue's wait list.
  Atomically creates a new job in the source queue and removes the DLQ job.

  Input:
    KEYS[1]  DLQ job hash key
    KEYS[2]  DLQ wait key
    KEYS[3]  source wait key
    KEYS[4]  source job hash key (pre-computed with new UUID)

    ARGV[1]  DLQ job id
    ARGV[2]  new job id (UUID for the replayed job)
    ARGV[3]  timestamp (ms)
    ARGV[4]  JSON job data (original data, without _dlqMeta)
    ARGV[5]  job name
    ARGV[6]  JSON opts (original job opts)
    ARGV[7]  source events stream key (for 'waiting' event; may be empty string)

  Output:
    newJobId  - the new job ID in the source queue
    -1        - DLQ job not found
]]
local rcall = redis.call

local dlqJobId = ARGV[1]
local newJobId = ARGV[2]

-- Verify DLQ job exists
local exists = rcall('EXISTS', KEYS[1])
if exists == 0 then
  return -1
end

-- Create new job in source queue with reset attemptsMade
rcall('HSET', KEYS[4],
  'name', ARGV[5],
  'data', ARGV[4],
  'opts', ARGV[6],
  'timestamp', ARGV[3],
  'attemptsMade', 0
)

-- Add to source wait list (LPUSH = FIFO ordering, consistent with addStandardJob)
rcall('LPUSH', KEYS[3], newJobId)

-- Emit 'waiting' event on source queue events stream
if ARGV[7] and ARGV[7] ~= '' then
  rcall('XADD', ARGV[7], '*',
    'event', 'waiting',
    'jobId', newJobId
  )
end

-- Remove DLQ job hash
rcall('DEL', KEYS[1])

-- Remove DLQ job from wait list
rcall('LREM', KEYS[2], -1, dlqJobId)

return newJobId
