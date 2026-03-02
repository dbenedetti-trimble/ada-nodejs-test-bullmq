--[[
  Update group state when a member job completes or fails.
  Called as a post-completion hook after moveToFinished.

  Input:
    KEYS[1] group hash key ({prefix}:{queueName}:groups:{groupId})
    KEYS[2] group jobs key ({prefix}:{queueName}:groups:{groupId}:jobs)
    KEYS[3] event stream key ({prefix}:{queueName}:events)

    ARGV[1] job key
    ARGV[2] new status ("completed" or "failed")
    ARGV[3] timestamp (epoch ms)
    ARGV[4] return value (if completed, empty string otherwise)
    ARGV[5] group name
    ARGV[6] group ID
    ARGV[7] failure reason (if failed, empty string otherwise)

  Output:
    0         - no state transition (group still ACTIVE)
    1         - group transitioned to COMPLETED
    2         - group transitioned to COMPENSATING (caller must handle compensation)
    3         - group transitioned to FAILED (no completed jobs to compensate)
    -1        - group not found or not in ACTIVE/COMPENSATING state
]]
local groupHashKey = KEYS[1]
local groupJobsKey = KEYS[2]
local eventStreamKey = KEYS[3]

local jobKey = ARGV[1]
local newStatus = ARGV[2]
local timestamp = ARGV[3]
local returnValue = ARGV[4]
local groupName = ARGV[5]

local state = redis.call("HGET", groupHashKey, "state")
if not state then
  return -1
end

redis.call("HSET", groupJobsKey, jobKey, newStatus)

if state == "COMPENSATING" then
  -- Group already compensating; just update the job status, no further transition
  if newStatus == "completed" then
    redis.call("HINCRBY", groupHashKey, "completedCount", 1)
  elseif newStatus == "failed" then
    redis.call("HINCRBY", groupHashKey, "failedCount", 1)
  end
  redis.call("HSET", groupHashKey, "updatedAt", timestamp)
  return 0
end

if state ~= "ACTIVE" then
  return -1
end

if newStatus == "completed" then
  local newCompleted = redis.call("HINCRBY", groupHashKey, "completedCount", 1)
  redis.call("HSET", groupHashKey, "updatedAt", timestamp)

  local totalJobs = tonumber(redis.call("HGET", groupHashKey, "totalJobs"))
  if newCompleted == totalJobs then
    redis.call("HSET", groupHashKey, "state", "COMPLETED", "updatedAt", timestamp)

    redis.call("XADD", eventStreamKey, "*",
      "event", "group:completed",
      "groupId", ARGV[6] or "",
      "groupName", groupName)

    return 1
  end
  return 0

elseif newStatus == "failed" then
  redis.call("HINCRBY", groupHashKey, "failedCount", 1)
  redis.call("HSET", groupHashKey, "updatedAt", timestamp)

  local completedCount = tonumber(redis.call("HGET", groupHashKey, "completedCount"))
  if completedCount > 0 then
    redis.call("HSET", groupHashKey, "state", "COMPENSATING", "updatedAt", timestamp)

    redis.call("XADD", eventStreamKey, "*",
      "event", "group:compensating",
      "groupId", ARGV[6] or "",
      "groupName", groupName,
      "failedJobId", jobKey,
      "reason", ARGV[7] or "")

    return 2
  else
    redis.call("HSET", groupHashKey, "state", "FAILED", "updatedAt", timestamp)

    redis.call("XADD", eventStreamKey, "*",
      "event", "group:failed",
      "groupId", ARGV[6] or "",
      "groupName", groupName,
      "state", "FAILED")

    return 3
  end
end

return 0
