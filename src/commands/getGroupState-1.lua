--[[
  Read group metadata hash from Redis.

  Input:
    KEYS[1] group hash key ({prefix}:{queueName}:groups:{groupId})

  Output:
    table - flat array of hash field/value pairs (HGETALL result), or empty if not found
]]
-- TODO: implement in features pass
local result = redis.call("HGETALL", KEYS[1])
return result
