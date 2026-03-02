--[[
  Cancel pending/waiting/delayed jobs in a group.
  Used during compensation trigger or manual group cancellation.

  Input:
    KEYS[1] group hash key ({prefix}:{queueName}:groups:{groupId})
    KEYS[2] group jobs key ({prefix}:{queueName}:groups:{groupId}:jobs)
    KEYS[3] event stream key ({prefix}:{queueName}:events)

    ARGV[1] timestamp (epoch ms)
    ARGV[2] group ID
    ARGV[3] prefix

  Output:
    number - count of cancelled jobs
]]
local groupHashKey = KEYS[1]
local groupJobsKey = KEYS[2]
local eventStreamKey = KEYS[3]

local timestamp = ARGV[1]
local groupId = ARGV[2]
local prefix = ARGV[3]

local cancelledCount = 0
local allJobs = redis.call("HGETALL", groupJobsKey)

for i = 1, #allJobs, 2 do
  local jobKey = allJobs[i]
  local status = allJobs[i + 1]

  if status == "pending" then
    redis.call("HSET", groupJobsKey, jobKey, "cancelled")

    -- Try to remove from wait list, delayed set, and prioritized set
    -- jobKey format is {prefix}:{queueName}:{jobId}
    local parts = {}
    for part in jobKey:gmatch("[^:]+") do
      table.insert(parts, part)
    end
    if #parts >= 3 then
      local queuePrefix = parts[1]
      local queueName = parts[2]
      local jobId = parts[3]
      local queueBase = queuePrefix .. ":" .. queueName

      redis.call("LREM", queueBase .. ":wait", 0, jobId)
      redis.call("LREM", queueBase .. ":paused", 0, jobId)
      redis.call("ZREM", queueBase .. ":delayed", jobId)
      redis.call("ZREM", queueBase .. ":prioritized", jobId)
    end

    cancelledCount = cancelledCount + 1
  end
end

if cancelledCount > 0 then
  redis.call("HINCRBY", groupHashKey, "cancelledCount", cancelledCount)
  redis.call("HSET", groupHashKey, "updatedAt", timestamp)
end

return cancelledCount
