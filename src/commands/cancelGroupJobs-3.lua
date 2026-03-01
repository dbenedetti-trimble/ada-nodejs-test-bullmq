--[[
  Cancels all pending/waiting/delayed member jobs within a group.

  Iterates the group jobs hash and removes pending jobs from their
  respective queue sets (wait list, delayed ZSET, prioritized ZSET).
  Updates per-job status to "cancelled" and increments cancelledCount.

  Input:
    KEYS[1] group hash key        ({prefix}:{queueName}:groups:{groupId})
    KEYS[2] group jobs hash key   ({prefix}:{queueName}:groups:{groupId}:jobs)
    KEYS[3] event stream key      ({prefix}:{queueName}:events)

    ARGV[1] timestamp (epoch ms)
    ARGV[2] group ID

  Output:
    Array: [cancelledCount, completedCount]
]]

local groupHashKey = KEYS[1]
local groupJobsKey = KEYS[2]
local eventsKey = KEYS[3]

local timestamp = ARGV[1]

local rcall = redis.call

-- 1. HGETALL group jobs hash to get all jobKey -> status pairs
local allJobs = rcall("HGETALL", groupJobsKey)
local cancelledCount = 0
local completedCount = 0

-- 2. For each job, cancel pending ones and count completed ones
for i = 1, #allJobs, 2 do
  local jobKey = allJobs[i]
  local jobStatus = allJobs[i+1]

  if jobStatus == "pending" then
    local jobId = string.match(jobKey, ":([^:]+)$")
    local baseKey = string.match(jobKey, "^(.+):[^:]+$")

    if jobId and baseKey then
      -- Try to remove from wait list, delayed ZSET, and prioritized ZSET
      rcall("LREM", baseKey .. ":wait", 0, jobId)
      rcall("ZREM", baseKey .. ":delayed", jobId)
      rcall("ZREM", baseKey .. ":prioritized", jobId)
    end

    rcall("HSET", groupJobsKey, jobKey, "cancelled")
    cancelledCount = cancelledCount + 1

  elseif jobStatus == "completed" then
    completedCount = completedCount + 1
  end
end

-- 3. Update group hash counters
if cancelledCount > 0 then
  rcall("HINCRBY", groupHashKey, "cancelledCount", cancelledCount)
  rcall("HSET", groupHashKey, "updatedAt", timestamp)
end

return {cancelledCount, completedCount}
