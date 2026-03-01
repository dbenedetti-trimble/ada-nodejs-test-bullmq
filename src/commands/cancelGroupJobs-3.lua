--[[
  Cancels all pending/waiting/delayed/prioritized jobs in a group.
  Atomically transitions group state and updates counts.

  Called from:
  1. Queue.cancelGroup() API (state must be ACTIVE)
  2. Worker compensation flow after updateGroupOnFinished (state may be COMPENSATING)

  Input:
    KEYS[1] group hash key        ({prefix}:{queueName}:groups:{groupId})
    KEYS[2] group jobs hash key   ({prefix}:{queueName}:groups:{groupId}:jobs)
    KEYS[3] events stream key     ({prefix}:{queueName}:events)

    ARGV[1] msgpacked arguments:
      [1] timestamp (epoch ms)

  Output:
    On error: negative integer
      -1: group not found
      -2: group already COMPLETED
      -3: group already FAILED or FAILED_COMPENSATION
    On success: array
      [1] cancelledCount (number)
      [2] completedJobsJson (JSON array of {fullJobKey, jobName, returnValue})
]]

local rcall = redis.call

local args = cmsgpack.unpack(ARGV[1])
local timestamp = args[1]

-- Extract groupId from key
local groupId = KEYS[1]:match(":groups:([^:]+)$")

local groupData = rcall("HMGET", KEYS[1], "state", "name", "completedCount")
local state = groupData[1]
local groupName = groupData[2]
local completedCount = tonumber(groupData[3]) or 0

if not state then
  return -1
end

if state == "COMPLETED" then
  return -2
end

if state == "FAILED" or state == "FAILED_COMPENSATION" then
  return -3
end

-- ACTIVE or COMPENSATING: cancel remaining pending/waiting/delayed/prioritized jobs
local cancelledCount = 0
local completedJobsList = {}

local jobsData = rcall("HGETALL", KEYS[2])
for i = 1, #jobsData, 2 do
  local jKey = jobsData[i]
  local jStatus = jobsData[i + 1]

  if jStatus == "pending" then
    -- Parse queueBase and jobId from fullJobKey ({prefix}:{queueName}:{jobId})
    local lastColon = 0
    for j = #jKey, 1, -1 do
      if jKey:sub(j, j) == ":" then
        lastColon = j
        break
      end
    end
    local queueBase = jKey:sub(1, lastColon - 1)
    local jobId = jKey:sub(lastColon + 1)

    -- Remove from all possible queue sets
    rcall("LREM", queueBase .. ":wait", 0, jobId)
    rcall("LREM", queueBase .. ":paused", 0, jobId)
    rcall("ZREM", queueBase .. ":delayed", jobId)
    rcall("ZREM", queueBase .. ":prioritized", jobId)

    -- Mark as cancelled in group jobs hash
    rcall("HSET", KEYS[2], jKey, "cancelled")
    cancelledCount = cancelledCount + 1

  elseif jStatus == "completed" then
    local jobName = rcall("HGET", jKey, "name")
    local jobReturnValue = rcall("HGET", jKey, "returnvalue")
    table.insert(completedJobsList, {
      fullJobKey = jKey,
      jobName = jobName or "",
      returnValue = jobReturnValue or "",
    })
  end
end

-- Update cancelled count in group hash
if cancelledCount > 0 then
  rcall("HINCRBY", KEYS[1], "cancelledCount", cancelledCount)
end
rcall("HSET", KEYS[1], "updatedAt", timestamp)

local maxEvents = 10000
local completedJobsJson = cjson.encode(completedJobsList)

-- Transition state only if ACTIVE
if state == "ACTIVE" then
  if completedCount > 0 then
    rcall("HSET", KEYS[1], "state", "COMPENSATING")
    rcall("XADD", KEYS[3], "MAXLEN", "~", maxEvents, "*",
      "event", "group:compensating",
      "groupId", groupId,
      "groupName", groupName,
      "failedJobId", "",
      "reason", "group cancelled manually")
  else
    rcall("HSET", KEYS[1], "state", "FAILED")
    rcall("XADD", KEYS[3], "MAXLEN", "~", maxEvents, "*",
      "event", "group:failed",
      "groupId", groupId,
      "groupName", groupName,
      "state", "FAILED")
  end
end

return {cancelledCount, completedJobsJson}
