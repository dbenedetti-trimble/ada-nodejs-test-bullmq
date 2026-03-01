--[[
  Atomically creates a job group in Redis.

  Sets up group metadata hash, per-job status hash, and groups index ZSET.
  Transitions group state to ACTIVE as part of creation.

  Input:
    KEYS[1] group hash key        ({prefix}:{queueName}:groups:{groupId})
    KEYS[2] group jobs hash key   ({prefix}:{queueName}:groups:{groupId}:jobs)
    KEYS[3] groups index ZSET key ({prefix}:{queueName}:groups)
    KEYS[4] event stream key      ({prefix}:{queueName}:events)

    ARGV[1] group ID
    ARGV[2] group name
    ARGV[3] timestamp (epoch ms)
    ARGV[4] total number of jobs
    ARGV[5] compensation JSON string
    ARGV[6..N] job keys (one per member job)

  Output:
    group ID on success
]]

local groupHashKey = KEYS[1]
local groupJobsKey = KEYS[2]
local groupsIndexKey = KEYS[3]
local eventsKey = KEYS[4]

local groupId = ARGV[1]
local groupName = ARGV[2]
local timestamp = ARGV[3]
local totalJobs = ARGV[4]
local compensationJson = ARGV[5]

local rcall = redis.call

-- 1. HSET group metadata
rcall("HSET", groupHashKey,
  "id", groupId,
  "name", groupName,
  "state", "ACTIVE",
  "createdAt", timestamp,
  "updatedAt", timestamp,
  "totalJobs", totalJobs,
  "completedCount", 0,
  "failedCount", 0,
  "cancelledCount", 0,
  "totalCompensations", 0,
  "completedCompensations", 0,
  "failedCompensations", 0,
  "compensation", compensationJson
)

-- 2. ZADD groups index with score=timestamp, member=groupId
rcall("ZADD", groupsIndexKey, timestamp, groupId)

-- 3. For each job key in ARGV[6..N], HSET group jobs hash: jobKey = "pending"
for i = 6, #ARGV do
  rcall("HSET", groupJobsKey, ARGV[i], "pending")
end

-- 4. XADD event stream: group:created event
rcall("XADD", eventsKey, "*",
  "event", "group:created",
  "groupId", groupId,
  "groupName", groupName
)

return groupId
