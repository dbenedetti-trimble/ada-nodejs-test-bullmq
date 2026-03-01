--[[
  Tracks compensation job completion and transitions group to terminal state.

  Called when a compensation job finishes (success or failure). When all
  compensation jobs are accounted for, transitions the group to FAILED or
  FAILED_COMPENSATION and emits the group:failed event.

  Input:
    KEYS[1] group hash key  ({prefix}:{queueName}:groups:{groupId})
    KEYS[2] event stream key ({prefix}:{queueName}:events)

    ARGV[1] compensation job key
    ARGV[2] compensation result: "success" | "failure"
    ARGV[3] timestamp (epoch ms)

  Output:
    New group state string, or "pending" if compensation is still in progress
]]

local groupHashKey = KEYS[1]
local eventsKey = KEYS[2]

local result = ARGV[2]
local timestamp = ARGV[3]

local rcall = redis.call

-- 1. Read group state and compensation counters
local data = rcall("HMGET", groupHashKey,
  "id", "name", "state",
  "totalCompensations", "completedCompensations", "failedCompensations")

local groupId = data[1]
local groupName = data[2]
local currentState = data[3]
local totalCompensations = tonumber(data[4]) or 0
local completedCompensations = tonumber(data[5]) or 0
local failedCompensations = tonumber(data[6]) or 0

-- Only process if currently in COMPENSATING state
if currentState ~= "COMPENSATING" then
  return "pending"
end

-- 2. Increment the appropriate counter
if result == "success" then
  completedCompensations = completedCompensations + 1
  rcall("HINCRBY", groupHashKey, "completedCompensations", 1)
else
  failedCompensations = failedCompensations + 1
  rcall("HINCRBY", groupHashKey, "failedCompensations", 1)
end

-- 3. Check if all compensations are done
local total = completedCompensations + failedCompensations
if totalCompensations > 0 and total >= totalCompensations then
  local newState
  if failedCompensations > 0 then
    newState = "FAILED_COMPENSATION"
  else
    newState = "FAILED"
  end

  rcall("HSET", groupHashKey,
    "state", newState,
    "updatedAt", timestamp
  )

  rcall("XADD", eventsKey, "*",
    "event", "group:failed",
    "groupId", groupId,
    "groupName", groupName,
    "state", newState
  )

  return newState
end

return "pending"
