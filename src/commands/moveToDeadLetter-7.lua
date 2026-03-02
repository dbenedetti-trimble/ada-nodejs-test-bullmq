--[[
  Move a job from the source queue's active list to the DLQ queue's wait list.
  Called from the terminal failure path when deadLetterQueue is configured.
  Releases the job lock, emits backward-compat 'failed' event and 'deadLettered' event.

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
    ARGV[5]  JSON job data with _dlqMeta embedded
    ARGV[6]  job name
    ARGV[7]  JSON original opts
    ARGV[8]  token (lock token; "0" to skip lock check)
    ARGV[9]  remove on fail (0 = keep source job hash, 1 = delete it)
    ARGV[10] failedReason (for backward-compat 'failed' event)
    ARGV[11] attemptsMade (total including current attempt)
    ARGV[12] max attempts (from job opts.attempts)
    ARGV[13] source stalled key (for lock release)

  Output:
    dlqJobId  - the new DLQ job ID
    -1        - job not found (not in active list or hash missing)
    -2        - lock missing
    -6        - lock mismatch (token does not match)
]]
local rcall = redis.call

--- Includes
--- @include "includes/removeLock"
--- @include "includes/trimEvents"

local jobId = ARGV[1]
local dlqJobId = ARGV[2]
local timestamp = ARGV[3]
local token = ARGV[8]
local jobIdKey = KEYS[2]

-- Verify job hash exists
if rcall('EXISTS', jobIdKey) == 0 then
  return -1
end

-- Release the lock (also removes from stalled set)
local stalledKey = ARGV[13]
local errorCode = removeLock(jobIdKey, stalledKey, token, jobId)
if errorCode < 0 then
  return errorCode
end

-- Trim events before emitting to avoid trimming our own events
trimEvents(KEYS[7], KEYS[3])

-- Remove from source active list
local numRemovedElements = rcall('LREM', KEYS[1], -1, jobId)
if numRemovedElements < 1 then
  return -1
end

-- Create DLQ job hash
rcall('HSET', KEYS[5],
  'name', ARGV[6],
  'data', ARGV[5],
  'opts', ARGV[7],
  'timestamp', timestamp,
  'attemptsMade', ARGV[11]
)

-- Add to DLQ wait list
rcall('LPUSH', KEYS[4], dlqJobId)

-- Emit backward-compat 'failed' event on source events stream
rcall('XADD', KEYS[3], '*',
  'event', 'failed',
  'jobId', jobId,
  'failedReason', ARGV[10],
  'prev', 'active'
)

-- Emit 'deadLettered' event on source events stream
rcall('XADD', KEYS[3], '*',
  'event', 'deadLettered',
  'jobId', jobId,
  'dlqJobId', dlqJobId,
  'deadLetterQueue', ARGV[4]
)

-- Emit 'waiting' event on DLQ events stream
rcall('XADD', KEYS[6], '*',
  'event', 'waiting',
  'jobId', dlqJobId
)

-- Emit 'retries-exhausted' event if all attempts were used
local attemptsMade = tonumber(ARGV[11])
local maxAttempts = tonumber(ARGV[12])
if maxAttempts and maxAttempts > 0 and attemptsMade >= maxAttempts then
  rcall('XADD', KEYS[3], '*',
    'event', 'retries-exhausted',
    'jobId', jobId,
    'attemptsMade', ARGV[11]
  )
end

-- Clean up source job hash per removeOnFail setting
if ARGV[9] == '1' then
  rcall('DEL', jobIdKey)
end

return dlqJobId
