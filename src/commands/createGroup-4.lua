--[[
  Create a transactional job group atomically.

  Input:
    KEYS[1] group hash key ({prefix}:{queueName}:groups:{groupId})
    KEYS[2] group jobs key ({prefix}:{queueName}:groups:{groupId}:jobs)
    KEYS[3] groups index key ({prefix}:{queueName}:groups)
    KEYS[4] event stream key ({prefix}:{queueName}:events)

    ARGV[1] group ID
    ARGV[2] group name
    ARGV[3] timestamp (epoch ms)
    ARGV[4] total jobs count
    ARGV[5] compensation JSON
    ARGV[6] job keys JSON array (stringified list of job keys)

  Output:
    0 - OK
]]
local groupHashKey = KEYS[1]
local groupJobsKey = KEYS[2]
local groupsIndexKey = KEYS[3]
local eventStreamKey = KEYS[4]

local groupId = ARGV[1]
local groupName = ARGV[2]
local timestamp = ARGV[3]
local totalJobs = ARGV[4]
local compensationJson = ARGV[5]
local jobKeysJson = ARGV[6]

redis.call("HSET", groupHashKey,
  "name", groupName,
  "state", "ACTIVE",
  "createdAt", timestamp,
  "updatedAt", timestamp,
  "totalJobs", totalJobs,
  "completedCount", 0,
  "failedCount", 0,
  "cancelledCount", 0,
  "compensation", compensationJson)

local jobKeys = cjson.decode(jobKeysJson)
for i, jobKey in ipairs(jobKeys) do
  redis.call("HSET", groupJobsKey, jobKey, "pending")
end

redis.call("ZADD", groupsIndexKey, timestamp, groupId)

return 0
