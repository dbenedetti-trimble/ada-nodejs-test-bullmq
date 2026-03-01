--[[
  Atomically creates a job group: stores group metadata, adds to groups index,
  and records per-job statuses as 'pending'.

  Input:
    KEYS[1] group hash key        ({prefix}:{queueName}:groups:{groupId})
    KEYS[2] group jobs hash key   ({prefix}:{queueName}:groups:{groupId}:jobs)
    KEYS[3] groups index ZSET key ({prefix}:{queueName}:groups)
    KEYS[4] events stream key     ({prefix}:{queueName}:events)

    ARGV[1] msgpacked arguments:
      [1] groupId
      [2] groupName
      [3] timestamp (epoch ms)
      [4] totalJobs (number)
      [5] compensationJson (JSON string)
      [6..N] fullJobKeys (one per job member)

  Output:
    groupId on success
]]

local rcall = redis.call

local args = cmsgpack.unpack(ARGV[1])
local groupId = args[1]
local groupName = args[2]
local timestamp = args[3]
local totalJobs = args[4]
local compensationJson = args[5]

-- Store group metadata hash (state starts as ACTIVE; PENDING is a transient internal state)
rcall("HMSET", KEYS[1],
  "name", groupName,
  "state", "ACTIVE",
  "createdAt", timestamp,
  "updatedAt", timestamp,
  "totalJobs", totalJobs,
  "completedCount", 0,
  "failedCount", 0,
  "cancelledCount", 0,
  "compensation", compensationJson,
  "compensationTotal", 0,
  "compensationDone", 0,
  "compensationFailed", 0
)

-- Add to groups index ZSET, scored by creation timestamp
rcall("ZADD", KEYS[3], timestamp, groupId)

-- Record each member job as 'pending' in the jobs hash
for i = 6, #args do
  rcall("HSET", KEYS[2], args[i], "pending")
end

-- Get max events for stream
local maxEvents = rcall("HGET", KEYS[4]:gsub(":events$", ":meta"), "opts.maxLenEvents")
if not maxEvents then
  maxEvents = 10000
end

-- Emit group created event
rcall("XADD", KEYS[4], "MAXLEN", "~", maxEvents, "*",
  "event", "group:created",
  "groupId", groupId,
  "groupName", groupName)

return groupId
