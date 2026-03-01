--[[
  Cancels all pending/waiting/delayed jobs in a group.
  Iterates the group jobs hash and removes pending entries from their
  respective queue sets (wait list, delayed ZSET, prioritized ZSET).
  Updates the group state to COMPENSATING or FAILED depending on whether
  any completed jobs exist.

  KEYS[1] group hash key    {prefix}:{queueName}:groups:{groupId}
  KEYS[2] group jobs key    {prefix}:{queueName}:groups:{groupId}:jobs
  KEYS[3] events stream key {prefix}:{queueName}:events

  ARGV[1] timestamp (epoch ms)
  ARGV[2] group ID
]]

local groupHashKey = KEYS[1]
local groupJobsKey = KEYS[2]
local eventsKey    = KEYS[3]

local timestamp = tonumber(ARGV[1])
local groupId   = ARGV[2]

local exists = redis.call("EXISTS", groupHashKey)
if exists == 0 then
  return {}
end

local state = redis.call("HGET", groupHashKey, "state")
-- Allow cancellation from ACTIVE (manual cancel) or COMPENSATING (sibling failure triggered it)
if state ~= "ACTIVE" and state ~= "COMPENSATING" then
  return {}
end

local completedCount = tonumber(redis.call("HGET", groupHashKey, "completedCount") or "0")
local groupName = redis.call("HGET", groupHashKey, "name")

-- Get all job entries
local jobEntries = redis.call("HGETALL", groupJobsKey)
local completedJobKeys = {}
local cancelledCount = 0

for i = 1, #jobEntries, 2 do
  local jkey    = jobEntries[i]
  local jstatus = jobEntries[i + 1]

  if jstatus == "completed" then
    table.insert(completedJobKeys, jkey)
  end

  if jstatus == "pending" then
    -- jobKey is {prefix}:{queueName}:{jobId} — extract jobId (last segment)
    local jobId = jkey:match(".*:(.+)")
    -- base key is everything before :{jobId}
    local baseKey = jkey:sub(1, #jkey - #jobId - 1)

    -- Try wait list first
    local removed = redis.call("LREM", baseKey .. ":wait", 0, jobId)

    if removed == 0 then
      -- Try delayed sorted set
      removed = redis.call("ZREM", baseKey .. ":delayed", jobId)
    end

    if removed == 0 then
      -- Try prioritized sorted set
      removed = redis.call("ZREM", baseKey .. ":prioritized", jobId)
    end

    -- Mark as cancelled regardless (job may already be active or not found)
    redis.call("HSET", groupJobsKey, jkey, "cancelled")
    cancelledCount = cancelledCount + 1
  end
end

if cancelledCount > 0 then
  redis.call("HINCRBY", groupHashKey, "cancelledCount", cancelledCount)
end

redis.call("HSET", groupHashKey, "updatedAt", timestamp)

-- Only perform state transition when coming from ACTIVE (not when already COMPENSATING)
if state == "ACTIVE" then
  if completedCount > 0 then
    redis.call("HSET", groupHashKey, "state", "COMPENSATING", "updatedAt", timestamp)
    redis.call("XADD", eventsKey, "*",
      "event", "group:compensating",
      "groupId", groupId,
      "groupName", groupName,
      "failedJobId", "",
      "reason", "group cancelled"
    )
  else
    redis.call("HSET", groupHashKey, "state", "FAILED", "updatedAt", timestamp)
    redis.call("XADD", eventsKey, "*",
      "event", "group:failed",
      "groupId", groupId,
      "groupName", groupName,
      "state", "FAILED"
    )
  end
end

return completedJobKeys
