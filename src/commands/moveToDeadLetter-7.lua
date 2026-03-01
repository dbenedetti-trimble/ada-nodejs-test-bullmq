--[[
  Move a job from the source queue's active list to the DLQ queue's wait list.
  Called from the terminal failure path when deadLetterQueue is configured.

  Input:
    KEYS[1]  source active key
    KEYS[2]  source job hash key
    KEYS[3]  source events stream key
    KEYS[4]  DLQ wait key
    KEYS[5]  DLQ job hash key
    KEYS[6]  DLQ events stream key
    KEYS[7]  source meta key

    ARGV[1]  job id (source)
    ARGV[2]  DLQ job id (new UUID)
    ARGV[3]  timestamp (ms)
    ARGV[4]  DLQ queue name
    ARGV[5]  msgpacked job data with _dlqMeta embedded
    ARGV[6]  job name
    ARGV[7]  msgpacked opts
    ARGV[8]  remove on fail (0 = keep, 1 = remove)
    ARGV[9]  DLQ key prefix

  Output:
    dlqJobId  - the new DLQ job ID
    -1        - job not found
]]

-- TODO(features): implement atomic move from active to DLQ waiting
-- Stub: return placeholder DLQ job id
local rcall = redis.call

local jobId = ARGV[1]
local dlqJobId = ARGV[2]

-- Verify job exists in source active list
local numRemovedElements = rcall('LREM', KEYS[1], -1, jobId)
if numRemovedElements < 1 then
  return -1
end

-- Store DLQ job hash
rcall('HSET', KEYS[5],
  'name', ARGV[6],
  'data', ARGV[5],
  'opts', ARGV[7],
  'timestamp', ARGV[3],
  'attemptsMade', 0
)

-- Add to DLQ wait list
rcall('LPUSH', KEYS[4], dlqJobId)

-- Emit deadLettered event on source events stream
rcall('XADD', KEYS[3], '*',
  'event', 'deadLettered',
  'jobId', jobId,
  'dlqJobId', dlqJobId,
  'queue', ARGV[4]
)

-- Emit waiting event on DLQ events stream
rcall('XADD', KEYS[6], '*',
  'event', 'waiting',
  'jobId', dlqJobId
)

-- Clean up source job hash if removeOnFail is set
if ARGV[8] == '1' then
  rcall('DEL', KEYS[2])
end

return dlqJobId
