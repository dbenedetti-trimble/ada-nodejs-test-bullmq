--[[
  Reads group metadata from Redis.

  KEYS[1] group hash key {prefix}:{queueName}:groups:{groupId}

  Returns the flat field-value array from HGETALL, or nil if the key does not exist.
]]

local groupHashKey = KEYS[1]

local exists = redis.call("EXISTS", groupHashKey)
if exists == 0 then
  return nil
end

return redis.call("HGETALL", groupHashKey)
