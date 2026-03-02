--[[
  Track compensation job completion and transition to terminal state.
  Called after each compensation job finishes.

  Input:
    KEYS[1] group hash key ({prefix}:{queueName}:groups:{groupId})
    KEYS[2] event stream key ({prefix}:{queueName}:events)

    ARGV[1] success or failure ("success" | "failure")
    ARGV[2] timestamp (epoch ms)
    ARGV[3] group name

  Output:
    nil    - more compensation jobs pending
    "FAILED"                - all compensations done, all succeeded
    "FAILED_COMPENSATION"   - all compensations done, at least one failed
]]
local groupHashKey = KEYS[1]
local eventStreamKey = KEYS[2]

local result = ARGV[1]
local timestamp = ARGV[2]
local groupName = ARGV[3]

local state = redis.call("HGET", groupHashKey, "state")
if state ~= "COMPENSATING" then
  return nil
end

if result == "success" then
  redis.call("HINCRBY", groupHashKey, "compSuccessCount", 1)
elseif result == "failure" then
  redis.call("HINCRBY", groupHashKey, "compFailureCount", 1)
end

redis.call("HSET", groupHashKey, "updatedAt", timestamp)

local totalCompJobs = tonumber(redis.call("HGET", groupHashKey, "totalCompJobs") or "0")
local compSuccess = tonumber(redis.call("HGET", groupHashKey, "compSuccessCount") or "0")
local compFailure = tonumber(redis.call("HGET", groupHashKey, "compFailureCount") or "0")

if totalCompJobs > 0 and (compSuccess + compFailure) >= totalCompJobs then
  local terminalState
  if compFailure > 0 then
    terminalState = "FAILED_COMPENSATION"
  else
    terminalState = "FAILED"
  end

  redis.call("HSET", groupHashKey, "state", terminalState, "updatedAt", timestamp)

  local groupId = ARGV[4] or ""

  redis.call("XADD", eventStreamKey, "*",
    "event", "group:failed",
    "groupId", groupId,
    "groupName", groupName,
    "state", terminalState)

  return terminalState
end

return nil
