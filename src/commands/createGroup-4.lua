--[[
  Creates a job group atomically.

  KEYS[1] group hash key      {prefix}:{queueName}:groups:{groupId}
  KEYS[2] group jobs key      {prefix}:{queueName}:groups:{groupId}:jobs
  KEYS[3] groups index key    {prefix}:{queueName}:groups   (ZSET)
  KEYS[4] events stream key   {prefix}:{queueName}:events

  ARGV[1] group ID
  ARGV[2] group name
  ARGV[3] timestamp (epoch ms)
  ARGV[4] total jobs count
  ARGV[5] compensation JSON string
  ARGV[6..N] job keys (one per group member, set to "pending")
]]

local groupHashKey   = KEYS[1]
local groupJobsKey   = KEYS[2]
local groupsIndexKey = KEYS[3]
local eventsKey      = KEYS[4]

local groupId      = ARGV[1]
local groupName    = ARGV[2]
local timestamp    = tonumber(ARGV[3])
local totalJobs    = tonumber(ARGV[4])
local compensation = ARGV[5]

-- TODO(features): implement full atomic group creation:
--   HSET group metadata (name, state, createdAt, updatedAt, totalJobs, completedCount=0,
--        failedCount=0, cancelledCount=0, compensation)
--   ZADD groupsIndexKey timestamp groupId
--   For each jobKey in ARGV[6..N]: HSET groupJobsKey jobKey "pending"
-- Return 1 on success.

return 1
