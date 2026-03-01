--[[
  Reads group metadata from Redis.

  Input:
    KEYS[1] group hash key ({prefix}:{queueName}:groups:{groupId})

  Output:
    Flat array from HGETALL (field, value, field, value, ...) or nil if not found.
]]

-- TODO(features): implement HGETALL and nil-check
-- Stub returns nil for scaffold.

local rcall = redis.call

local exists = rcall("EXISTS", KEYS[1])
if exists == 0 then
  return nil
end

return rcall("HGETALL", KEYS[1])
