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

-- TODO(features): implement atomic group creation logic
-- Stub returns groupId from ARGV for scaffold validation only.

local rcall = redis.call

-- Placeholder: real implementation will unpack ARGV[1] via msgpack
-- and perform HSET, ZADD, HSET-per-job operations.

return "stub"
