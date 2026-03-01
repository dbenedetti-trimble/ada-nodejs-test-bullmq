--[[
  Atomically enqueues compensation jobs for completed group member jobs.

  Each compensation job is added to {prefix}:{compensationQueueName}:wait
  as a standard BullMQ job with group membership opts set for tracking.

  Input:
    KEYS[1] compensation queue wait key  ({prefix}:{compensationQueueName}:wait)
    KEYS[2] compensation queue meta key  ({prefix}:{compensationQueueName}:meta)
    KEYS[3] compensation queue event stream key ({prefix}:{compensationQueueName}:events)

    ARGV[1] msgpacked array of compensation job descriptors:
            Each descriptor: { jobName, groupId, groupName, ownerQueueName,
                               originalJobName, originalJobId, originalReturnValue,
                               compensationData, attempts, backoff }
    ARGV[2] group hash key (for updating totalCompensations; empty string to skip)

  Output:
    Number of compensation jobs enqueued
]]

local waitKey = KEYS[1]
local metaKey = KEYS[2]
local eventsKey = KEYS[3]

local rcall = redis.call

-- Derive base key from wait key (strips ":wait" suffix)
local baseKey = string.match(waitKey, "^(.+):wait$")
local idKey = baseKey .. ":id"

-- Get max events from meta key
local maxEvents = tonumber(rcall("HGET", metaKey, "opts.maxLenEvents")) or 10000

-- Unpack compensation job descriptors
local descriptors = cmsgpack.unpack(ARGV[1])
local groupHashKey = ARGV[2]
local count = 0
local nowMs = tostring(redis.call("TIME")[1]) .. "000"

for _, desc in ipairs(descriptors) do
  -- Generate a unique job ID
  local jobId = tostring(rcall("INCR", idKey))
  local jobHashKey = baseKey .. ":" .. jobId

  -- Build opts with group membership for compensation tracking
  local optsTable = {
    attempts = desc.attempts or 3,
    group = {
      id = desc.groupId,
      name = desc.groupName or "",
      queueName = desc.ownerQueueName,
      isCompensation = true
    }
  }
  if desc.backoff then
    optsTable.backoff = desc.backoff
  end

  local dataTable = {
    groupId = desc.groupId,
    ownerQueueName = desc.ownerQueueName,
    originalJobName = desc.originalJobName,
    originalJobId = desc.originalJobId,
    originalReturnValue = desc.originalReturnValue
  }
  if desc.compensationData ~= nil then
    dataTable.compensationData = desc.compensationData
  end

  rcall("HMSET", jobHashKey,
    "name", desc.jobName,
    "data", cjson.encode(dataTable),
    "opts", cjson.encode(optsTable),
    "timestamp", nowMs,
    "delay", 0,
    "priority", 0
  )

  rcall("LPUSH", waitKey, jobId)

  rcall("XADD", eventsKey, "MAXLEN", "~", maxEvents, "*",
    "event", "waiting",
    "jobId", jobId,
    "name", desc.jobName
  )

  count = count + 1
end

-- Update totalCompensations on the group hash if key provided
if groupHashKey and groupHashKey ~= "" then
  rcall("HSET", groupHashKey, "totalCompensations", count)
end

return count
