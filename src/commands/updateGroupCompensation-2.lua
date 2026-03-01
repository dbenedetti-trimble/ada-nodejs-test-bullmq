--[[
  Tracks the completion of a single compensation job and transitions the group
  to its terminal state when all compensation jobs have finished.

  KEYS[1] group hash key    {prefix}:{queueName}:groups:{groupId}
  KEYS[2] events stream key {prefix}:{queueName}:events

  ARGV[1] compensation job key
  ARGV[2] outcome: "success" | "failure"
  ARGV[3] timestamp (epoch ms)
  ARGV[4] group ID
]]

local groupHashKey = KEYS[1]
local eventsKey    = KEYS[2]

local compJobKey  = ARGV[1]
local outcome     = ARGV[2]
local timestamp   = tonumber(ARGV[3])
local groupId     = ARGV[4]

local exists = redis.call("EXISTS", groupHashKey)
if exists == 0 then
  return nil
end

local state = redis.call("HGET", groupHashKey, "state")
-- Only process when in COMPENSATING state
if state ~= "COMPENSATING" then
  return nil
end

redis.call("HINCRBY", groupHashKey, "compensationCompleted", 1)

if outcome == "failure" then
  redis.call("HINCRBY", groupHashKey, "compensationFailed", 1)
end

redis.call("HSET", groupHashKey, "updatedAt", timestamp)

local compensationCompleted  = tonumber(redis.call("HGET", groupHashKey, "compensationCompleted"))
local totalCompensationJobs  = tonumber(redis.call("HGET", groupHashKey, "totalCompensationJobs") or "0")
local groupName              = redis.call("HGET", groupHashKey, "name")

if totalCompensationJobs == 0 or compensationCompleted < totalCompensationJobs then
  return nil
end

local compensationFailed = tonumber(redis.call("HGET", groupHashKey, "compensationFailed") or "0")

local finalState
if compensationFailed and compensationFailed > 0 then
  finalState = "FAILED_COMPENSATION"
else
  finalState = "FAILED"
end

redis.call("HSET", groupHashKey, "state", finalState, "updatedAt", timestamp)
redis.call("XADD", eventsKey, "*",
  "event", "group:failed",
  "groupId", groupId,
  "groupName", groupName,
  "state", finalState
)

return finalState
