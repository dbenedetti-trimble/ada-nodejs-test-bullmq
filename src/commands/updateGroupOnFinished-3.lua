--[[
  Called after a group member job moves to its final state (completed or failed).
  Atomically updates group job status, increments counters, and triggers state
  transitions. Returns a table describing the resulting transition so the caller
  (Worker) can enqueue compensation jobs if needed.

  KEYS[1] group hash key    {prefix}:{queueName}:groups:{groupId}
  KEYS[2] group jobs key    {prefix}:{queueName}:groups:{groupId}:jobs
  KEYS[3] events stream key {prefix}:{queueName}:events

  ARGV[1] job key (fully-qualified: {prefix}:{jobQueueName}:{jobId})
  ARGV[2] new status: "completed" | "failed"
  ARGV[3] timestamp (epoch ms)
  ARGV[4] return value JSON (may be empty string for failed jobs)
]]

local groupHashKey = KEYS[1]
local groupJobsKey = KEYS[2]
local eventsKey    = KEYS[3]

local jobKey      = ARGV[1]
local newStatus   = ARGV[2]
local timestamp   = tonumber(ARGV[3])
local returnValue = ARGV[4]

local exists = redis.call("EXISTS", groupHashKey)
if exists == 0 then
  return nil
end

local state = redis.call("HGET", groupHashKey, "state")

-- Idempotency: no-op if already in terminal or COMPENSATING state
if state == "COMPLETED" or state == "COMPENSATING" or
   state == "FAILED" or state == "FAILED_COMPENSATION" then
  return nil
end

-- Update job status in membership hash
redis.call("HSET", groupJobsKey, jobKey, newStatus)

-- Increment appropriate counter
if newStatus == "completed" then
  redis.call("HINCRBY", groupHashKey, "completedCount", 1)
else
  redis.call("HINCRBY", groupHashKey, "failedCount", 1)
end

redis.call("HSET", groupHashKey, "updatedAt", timestamp)

local totalJobs      = tonumber(redis.call("HGET", groupHashKey, "totalJobs"))
local completedCount = tonumber(redis.call("HGET", groupHashKey, "completedCount"))
local groupName      = redis.call("HGET", groupHashKey, "name")
-- Extract groupId from the hash key: {prefix}:{queueName}:groups:{groupId}
local groupId = groupHashKey:match(".*:groups:(.+)")

if newStatus == "completed" and completedCount == totalJobs then
  redis.call("HSET", groupHashKey, "state", "COMPLETED", "updatedAt", timestamp)
  redis.call("XADD", eventsKey, "*",
    "event", "group:completed",
    "groupId", groupId,
    "groupName", groupName
  )
  return nil
end

if newStatus == "failed" then
  redis.call("HSET", groupHashKey, "state", "COMPENSATING", "updatedAt", timestamp)

  -- Collect completed job keys for compensation
  local jobEntries = redis.call("HGETALL", groupJobsKey)
  local completedJobKeys = {}
  for i = 1, #jobEntries, 2 do
    if jobEntries[i + 1] == "completed" then
      table.insert(completedJobKeys, jobEntries[i])
    end
  end

  -- Extract jobId from jobKey for the event
  local jobId = jobKey:match(".*:(.+)")

  redis.call("XADD", eventsKey, "*",
    "event", "group:compensating",
    "groupId", groupId,
    "groupName", groupName,
    "failedJobId", jobId,
    "reason", "job failed after exhausting retries"
  )

  -- Return marker + completed job keys: result[1] = "compensation", result[2..] = completed keys
  local result = { "compensation" }
  for _, k in ipairs(completedJobKeys) do
    table.insert(result, k)
  end
  return result
end

return nil
