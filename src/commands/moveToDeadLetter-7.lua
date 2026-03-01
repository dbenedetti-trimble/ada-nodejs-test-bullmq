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
    ARGV[4]  packed opts (token, keepJobs, dlqQueueName)
    ARGV[5]  dlqMeta JSON string (sourceQueue, originalJobId, failedReason,
                                  stacktrace, attemptsMade, deadLetteredAt,
                                  originalTimestamp, originalOpts)

  Output:
    dlqJobId on success
    -1 Missing key (job not found)
    -2 Missing lock
    -3 Job not in active list
    -6 Lock is not owned by this client

  Events:
    failed (on source events stream, for backward compatibility)
    deadLettered (on source events stream)
    waiting (on DLQ events stream)
]]

local rcall = redis.call

--- @include "includes/trimEvents"
--- @include "includes/removeJobKeys"

local jobIdKey = KEYS[2]
if rcall("EXISTS", jobIdKey) == 0 then
  return -1
end

local opts = cmsgpack.unpack(ARGV[4])
local token = opts['token']
local keepJobs = opts['keepJobs']
local dlqQueueName = opts['dlqQueueName']

-- Release the job lock (no stalled key available; stale entry cleaned by stall checker)
if token ~= "0" then
  local lockKey = jobIdKey .. ':lock'
  local lockToken = rcall("GET", lockKey)
  if lockToken == token then
    rcall("DEL", lockKey)
  elseif lockToken then
    return -6
  else
    return -2
  end
end

-- Remove from source active list
local numRemoved = rcall("LREM", KEYS[1], -1, ARGV[1])
if numRemoved < 1 then
  return -3
end

-- Read source job fields needed for the DLQ job
local jobFields = rcall("HMGET", jobIdKey, "name", "data", "opts", "timestamp")
local jobName = jobFields[1] or ""
local jobDataStr = jobFields[2] or "{}"
local jobOptsStr = jobFields[3] or "{}"

-- Parse dlqMeta from ARGV[5] (JSON string) and embed in job data
local dlqMeta = cjson.decode(ARGV[5])
local originalData = cjson.decode(jobDataStr)
originalData['_dlqMeta'] = dlqMeta
local dlqDataStr = cjson.encode(originalData)

local dlqJobId = ARGV[3]

-- Store DLQ job hash (new waiting job in the DLQ queue)
rcall("HMSET", KEYS[5],
  "name", jobName,
  "data", dlqDataStr,
  "opts", jobOptsStr,
  "timestamp", ARGV[2],
  "delay", 0,
  "priority", 0)

-- Add to DLQ waiting list (LPUSH = newest first)
rcall("LPUSH", KEYS[4], dlqJobId)

-- Trim and emit events on source stream
rcall("XTRIM", KEYS[3], "MAXLEN", "~", 10000)
rcall("XADD", KEYS[3], "*", "event", "failed", "jobId", ARGV[1],
  "failedReason", dlqMeta['failedReason'] or "", "prev", "active")
rcall("XADD", KEYS[3], "*", "event", "deadLettered", "jobId", ARGV[1],
  "deadLetterQueue", dlqQueueName or "")

-- Trim and emit waiting event on DLQ stream
trimEvents(KEYS[7], KEYS[6])
rcall("XADD", KEYS[6], "*", "event", "waiting", "jobId", dlqJobId)

-- Conditionally remove source job hash per keepJobs setting
local maxCount = -1
if keepJobs then
  maxCount = keepJobs['count'] or -1
end
if maxCount == 0 then
  removeJobKeys(jobIdKey)
end

return dlqJobId
