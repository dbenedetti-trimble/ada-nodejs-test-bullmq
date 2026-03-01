--[[
  Called after moveToFinished completes for a group member job.
  Increments the appropriate counter, checks for terminal state, and emits events.

  Input:
    KEYS[1] group hash key        ({prefix}:{queueName}:groups:{groupId})
    KEYS[2] group jobs hash key   ({prefix}:{queueName}:groups:{groupId}:jobs)
    KEYS[3] events stream key     ({prefix}:{queueName}:events)

    ARGV[1] msgpacked arguments:
      [1] fullJobKey   (fully qualified job key: {prefix}:{queueName}:{jobId})
      [2] newStatus    ("completed" | "failed")
      [3] timestamp    (epoch ms)
      [4] returnValue  (JSON string, may be empty string for failed)
      [5] failedJobId  (jobId, may be empty string for completed)

  Output (plain array, positions):
    [1] action:    "none" | "cancel_and_compensate"
    [2] groupState: new group state string
    [3] completedJobsJson: JSON array of {fullJobKey, jobName, returnValue} objects
]]

local rcall = redis.call

local args = cmsgpack.unpack(ARGV[1])
local fullJobKey = args[1]
local newStatus = args[2]
local timestamp = args[3]
local returnValue = args[4] or ""
local failedJobId = args[5] or ""

-- Extract groupId from the group hash key
local groupId = KEYS[1]:match(":groups:([^:]+)$")

-- Read current group state data in one call
local groupData = rcall("HMGET", KEYS[1], "state", "name", "totalJobs", "completedCount", "failedCount", "compensation")
local state = groupData[1]
local groupName = groupData[2]
local totalJobs = tonumber(groupData[3])
local completedCount = tonumber(groupData[4]) or 0
local failedCount = tonumber(groupData[5]) or 0
local compensationJson = groupData[6] or "{}"

if not state then
  return {"none", "UNKNOWN", "[]"}
end

-- Idempotency: if already in terminal or compensating state, return no-op
if state == "COMPLETED" or state == "COMPENSATING" or state == "FAILED" or state == "FAILED_COMPENSATION" then
  return {"none", state, "[]"}
end

-- Update job status in group jobs hash
rcall("HSET", KEYS[2], fullJobKey, newStatus)

-- Increment the appropriate counter
if newStatus == "completed" then
  completedCount = completedCount + 1
  rcall("HINCRBY", KEYS[1], "completedCount", 1)
else
  failedCount = failedCount + 1
  rcall("HINCRBY", KEYS[1], "failedCount", 1)
end

rcall("HSET", KEYS[1], "updatedAt", timestamp)

local maxEvents = 10000

-- Check: all jobs completed → COMPLETED
if newStatus == "completed" and completedCount >= totalJobs then
  rcall("HSET", KEYS[1], "state", "COMPLETED")
  rcall("XADD", KEYS[3], "MAXLEN", "~", maxEvents, "*",
    "event", "group:completed",
    "groupId", groupId,
    "groupName", groupName)
  return {"none", "COMPLETED", "[]"}
end

-- Check: job failed → trigger compensation or go directly to FAILED
if newStatus == "failed" then
  -- Gather all completed jobs from the group jobs hash
  local jobsData = rcall("HGETALL", KEYS[2])
  local completedJobsList = {}
  for i = 1, #jobsData, 2 do
    local jKey = jobsData[i]
    local jStatus = jobsData[i + 1]
    if jStatus == "completed" then
      local jobName = rcall("HGET", jKey, "name")
      local jobReturnValue = rcall("HGET", jKey, "returnvalue")
      table.insert(completedJobsList, {
        fullJobKey = jKey,
        jobName = jobName or "",
        returnValue = jobReturnValue or "",
      })
    end
  end

  -- Parse compensation mapping to count jobs with compensation entries
  local compensation = cjson.decode(compensationJson)
  local compensationTotal = 0
  for _, cj in ipairs(completedJobsList) do
    if compensation[cj.jobName] then
      compensationTotal = compensationTotal + 1
    end
  end

  local completedJobsJson = cjson.encode(completedJobsList)

  if #completedJobsList == 0 then
    -- No completed siblings → cancel remaining pending/delayed/prioritized jobs and go to FAILED
    local cancelledCount = 0
    local allJobsData = rcall("HGETALL", KEYS[2])
    for i = 1, #allJobsData, 2 do
      local jKey = allJobsData[i]
      local jStatus = allJobsData[i + 1]
      if jStatus == "pending" then
        -- Extract queueBase and jobId from fullJobKey ({prefix}:{queueName}:{jobId})
        local lastColon = 0
        for j = #jKey, 1, -1 do
          if jKey:sub(j, j) == ":" then
            lastColon = j
            break
          end
        end
        local queueBase = jKey:sub(1, lastColon - 1)
        local jobId = jKey:sub(lastColon + 1)
        rcall("LREM", queueBase .. ":wait", 0, jobId)
        rcall("LREM", queueBase .. ":paused", 0, jobId)
        rcall("ZREM", queueBase .. ":delayed", jobId)
        rcall("ZREM", queueBase .. ":prioritized", jobId)
        rcall("HSET", KEYS[2], jKey, "cancelled")
        cancelledCount = cancelledCount + 1
      end
    end
    if cancelledCount > 0 then
      rcall("HINCRBY", KEYS[1], "cancelledCount", cancelledCount)
    end
    rcall("HSET", KEYS[1], "state", "FAILED")
    rcall("XADD", KEYS[3], "MAXLEN", "~", maxEvents, "*",
      "event", "group:failed",
      "groupId", groupId,
      "groupName", groupName,
      "state", "FAILED")
    return {"none", "FAILED", "[]"}
  else
    -- Completed siblings exist → COMPENSATING
    rcall("HMSET", KEYS[1],
      "state", "COMPENSATING",
      "compensationTotal", compensationTotal,
      "updatedAt", timestamp)
    rcall("XADD", KEYS[3], "MAXLEN", "~", maxEvents, "*",
      "event", "group:compensating",
      "groupId", groupId,
      "groupName", groupName,
      "failedJobId", failedJobId,
      "reason", "job failed after exhausting retries")
    return {"cancel_and_compensate", "COMPENSATING", completedJobsJson}
  end
end

return {"none", state, "[]"}
