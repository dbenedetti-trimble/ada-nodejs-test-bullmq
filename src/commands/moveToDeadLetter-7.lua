--[[
  Moves a job from the source queue's active list to a dead letter queue.

  Input:
    KEYS[1] source active key
    KEYS[2] source job hash key
    KEYS[3] source events stream
    KEYS[4] DLQ waiting key
    KEYS[5] DLQ job hash key
    KEYS[6] DLQ events stream
    KEYS[7] DLQ meta key

    ARGV[1] jobId (in source queue)
    ARGV[2] dlqJobId (new ID for DLQ job)
    ARGV[3] dlqQueueName
    ARGV[4] failedReason
    ARGV[5] timestamp
    ARGV[6] token (lock token)
    ARGV[7] source queue name
    ARGV[8] source stalled key
    ARGV[9] maxEvents for source
    ARGV[10] maxEvents for DLQ
    ARGV[11] current stacktrace (JSON string, up-to-date from TypeScript)

  Output:
    DLQ job ID on success
    Negative error code on failure:
      -1 Missing key for job
      -2 Missing lock
      -3 Job not in active set
      -6 Lock mismatch
]]
local rcall = redis.call

local jobIdKey = KEYS[2]

if rcall("EXISTS", jobIdKey) ~= 1 then
  return -1
end

local token = ARGV[6]
if token ~= "0" then
  local lockKey = jobIdKey .. ':lock'
  local lockToken = rcall("GET", lockKey)
  if lockToken == token then
    rcall("DEL", lockKey)
    rcall("SREM", ARGV[8], ARGV[1])
  else
    if lockToken then
      return -6
    else
      return -2
    end
  end
end

local jobId = ARGV[1]
local numRemovedElements = rcall("LREM", KEYS[1], -1, jobId)
if numRemovedElements < 1 then
  return -3
end

local sourceEventsKey = KEYS[3]
local sourceMaxEvents = ARGV[9]
rcall("XTRIM", sourceEventsKey, "MAXLEN", "~", sourceMaxEvents)

local jobData = rcall("HGETALL", jobIdKey)

local name = ""
local data = "{}"
local opts = "{}"
local timestamp_val = ARGV[5]
local stacktrace = ARGV[11] or "[]"
local attemptsMade = "0"

for i = 1, #jobData, 2 do
  local field = jobData[i]
  local value = jobData[i + 1]
  if field == "name" then
    name = value
  elseif field == "data" then
    data = value
  elseif field == "opts" then
    opts = value
  elseif field == "timestamp" then
    timestamp_val = value
  elseif field == "atm" then
    attemptsMade = value
  elseif field == "attemptsMade" then
    if attemptsMade == "0" then
      attemptsMade = value
    end
  end
end

local atm = tonumber(attemptsMade) or 0
atm = atm + 1

local dlqMeta = cjson.encode({
  sourceQueue = ARGV[7],
  originalJobId = jobId,
  failedReason = ARGV[4],
  stacktrace = cjson.decode(stacktrace),
  attemptsMade = atm,
  deadLetteredAt = tonumber(ARGV[5]),
  originalTimestamp = tonumber(timestamp_val),
  originalOpts = cjson.decode(opts)
})

local originalData = cjson.decode(data)
originalData["_dlqMeta"] = cjson.decode(dlqMeta)
local dlqData = cjson.encode(originalData)

local dlqJobId = ARGV[2]
local dlqJobIdKey = KEYS[5]
local dlqOpts = cjson.encode({})

rcall("HMSET", dlqJobIdKey,
  "name", name,
  "data", dlqData,
  "opts", dlqOpts,
  "timestamp", ARGV[5],
  "delay", 0,
  "priority", 0,
  "atm", 0,
  "ats", 0)

rcall("LPUSH", KEYS[4], dlqJobId)

local dlqMaxEvents = ARGV[10]
rcall("XTRIM", KEYS[6], "MAXLEN", "~", dlqMaxEvents)
rcall("XADD", KEYS[6], "*", "event", "waiting", "jobId", dlqJobId)

rcall("XADD", sourceEventsKey, "*", "event", "failed", "jobId", jobId,
  "failedReason", ARGV[4], "prev", "active")

rcall("XADD", sourceEventsKey, "*", "event", "deadLettered", "jobId", jobId,
  "queue", ARGV[7], "deadLetterQueue", ARGV[3], "failedReason", ARGV[4])

rcall("HINCRBY", jobIdKey, "atm", 1)
rcall("HSET", jobIdKey, "failedReason", ARGV[4], "finishedOn", ARGV[5])

rcall("DEL", jobIdKey, jobIdKey .. ':logs',
  jobIdKey .. ':dependencies', jobIdKey .. ':processed',
  jobIdKey .. ':failed', jobIdKey .. ':unsuccessful')

return dlqJobId
