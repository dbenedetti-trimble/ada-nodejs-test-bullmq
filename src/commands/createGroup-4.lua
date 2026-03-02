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
-- TODO: implement in features pass
return 0
