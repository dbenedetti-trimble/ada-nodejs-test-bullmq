--[[
  Enqueues compensation jobs atomically into a compensation queue's wait list.

  Input:
    KEYS[1] compensation queue wait list key  ({prefix}:{compQueueName}:wait)
    KEYS[2] compensation queue meta key       ({prefix}:{compQueueName}:meta)
    KEYS[3] compensation events stream key    ({prefix}:{compQueueName}:events)

    ARGV[1] msgpacked arguments:
      Array of compensation job entries, each a table:
        [1] jobName           (string)
        [2] jobDataJson       (JSON string: {groupId, originalJobName, originalJobId, originalReturnValue, compensationData, groupQueueName})
        [3] jobOptsJson       (JSON string: {attempts, backoff})

  Output:
    number of compensation jobs enqueued
]]

local rcall = redis.call

local jobEntries = cmsgpack.unpack(ARGV[1])

-- Derive id counter key from meta key: strip :meta suffix
local baseKey = KEYS[2]:match("(.+):meta$")
local idKey = baseKey .. ":id"

-- Get or initialize maxEvents
local maxEvents = rcall("HGET", KEYS[2], "opts.maxLenEvents")
if not maxEvents then
  maxEvents = 10000
  rcall("HSET", KEYS[2], "opts.maxLenEvents", maxEvents)
end

local jobCount = 0
local timestamp = tonumber(rcall("TIME")[1]) * 1000

for _, entry in ipairs(jobEntries) do
  local jobName = entry[1]
  local jobDataJson = entry[2]
  local jobOptsJson = entry[3]

  -- Increment the compensation queue's id counter to get a unique job ID
  local jobId = rcall("INCR", idKey)
  local jobIdKey = baseKey .. ":" .. jobId

  -- Store the compensation job hash
  rcall("HMSET", jobIdKey,
    "name", jobName,
    "data", jobDataJson,
    "opts", jobOptsJson,
    "timestamp", timestamp,
    "delay", 0,
    "priority", 0,
    "attemptsMade", 0,
    "attemptsStarted", 0,
    "stalledCounter", 0
  )

  -- Emit 'added' event
  rcall("XADD", KEYS[3], "MAXLEN", "~", maxEvents, "*",
    "event", "added",
    "jobId", jobId,
    "name", jobName)

  -- Push to wait list (LIFO for simplicity)
  rcall("LPUSH", KEYS[1], jobId)

  -- Emit 'waiting' event
  rcall("XADD", KEYS[3], "MAXLEN", "~", maxEvents, "*",
    "event", "waiting",
    "jobId", jobId)

  jobCount = jobCount + 1
end

return jobCount
