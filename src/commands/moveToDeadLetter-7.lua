--[[
  Move job from active to a dead letter queue on terminal failure.

  Note: This script accesses keys from two different queues (source and DLQ).
  In Redis Cluster mode, this requires both queues to use the same hash tag
  for atomicity. Without matching hash tags, this operation may fail in
  cluster deployments.

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
    ARGV[9] serialized stacktrace JSON from the Job object

  Output:
    DLQ job ID string on success
   -1 - Missing job.
   -2 - Missing lock.
   -3 - Job not in active set.

  Events:
    - 'deadLettered' on source events stream
    - 'waiting' on DLQ events stream
]]
local rcall = redis.call

--- @include "includes/removeLock"
--- @include "includes/trimEvents"

local srcActiveKey   = KEYS[1]
local srcJobKey      = KEYS[2]
local srcEventsKey   = KEYS[3]
local dlqWaitKey     = KEYS[4]
local dlqJobKey      = KEYS[5]
local dlqEventsKey   = KEYS[6]
local dlqMetaKey     = KEYS[7]

local srcPrefix      = ARGV[1]
local jobId          = ARGV[2]
local dlqJobId       = ARGV[3]
local dlqQueueName   = ARGV[4]
local timestamp      = ARGV[5]
local failedReason   = ARGV[6]
local token          = ARGV[7]
local packedOpts     = cmsgpack.unpack(ARGV[8])
local stacktraceJson = ARGV[9]

if rcall("EXISTS", srcJobKey) ~= 1 then
  return -1
end

local lockResult = removeLock(srcJobKey, srcPrefix .. "stalled", token, jobId)
if lockResult < 0 then
  return lockResult
end

local removed = rcall("LREM", srcActiveKey, 1, jobId)
if removed == 0 then
  return -3
end

local jobName = rcall("HGET", srcJobKey, "name") or ""
local jobData = rcall("HGET", srcJobKey, "data") or "{}"
local jobOpts = rcall("HGET", srcJobKey, "opts") or "{}"
local jobAttemptsMade = rcall("HGET", srcJobKey, "atm")
    or rcall("HGET", srcJobKey, "attemptsMade") or "0"
local jobTimestamp = rcall("HGET", srcJobKey, "timestamp") or timestamp

local srcQueueName = string.match(srcPrefix, ".*:(.+):$") or ""

local originalData = cjson.decode(jobData)
originalData["_dlqMeta"] = {
  sourceQueue = srcQueueName,
  originalJobId = jobId,
  failedReason = failedReason,
  stacktrace = cjson.decode(stacktraceJson),
  attemptsMade = tonumber(jobAttemptsMade) + 1,
  deadLetteredAt = tonumber(timestamp),
  originalTimestamp = tonumber(jobTimestamp),
  originalOpts = cjson.decode(jobOpts),
}
local dlqData = cjson.encode(originalData)

local dlqHmsetArgs = {
  "name", jobName,
  "data", dlqData,
  "opts", jobOpts,
  "timestamp", timestamp,
  "delay", 0,
  "priority", 0,
}

local optionalFields = {"parentKey", "parent", "rjk", "deid"}
for _, field in ipairs(optionalFields) do
  local val = rcall("HGET", srcJobKey, field)
  if val then
    dlqHmsetArgs[#dlqHmsetArgs + 1] = field
    dlqHmsetArgs[#dlqHmsetArgs + 1] = val
  end
end

rcall("HMSET", dlqJobKey, unpack(dlqHmsetArgs))

rcall("LPUSH", dlqWaitKey, dlqJobId)

rcall("XADD", srcEventsKey, "*",
  "event", "failed",
  "jobId", jobId,
  "failedReason", failedReason,
  "prev", "active")

rcall("XADD", srcEventsKey, "*",
  "event", "deadLettered",
  "jobId", jobId,
  "deadLetterQueue", dlqQueueName,
  "failedReason", failedReason)

trimEvents(dlqMetaKey, dlqEventsKey)

rcall("XADD", dlqEventsKey, "*",
  "event", "waiting",
  "jobId", dlqJobId)

local keepJobs = packedOpts['keepJobs']
if keepJobs then
  local count = keepJobs['count']
  if count and count == 0 then
    rcall("DEL", srcJobKey)
    local srcJobLogsKey = srcJobKey .. ":logs"
    rcall("DEL", srcJobLogsKey)
  end
end

return dlqJobId
