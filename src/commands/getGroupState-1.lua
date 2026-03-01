--[[
  Reads group metadata from Redis.

  Returns all fields of the group hash as a flat array for parsing
  by the TypeScript caller, or nil if the group does not exist.

  Input:
    KEYS[1] group hash key ({prefix}:{queueName}:groups:{groupId})

  Output:
    Flat array of field-value pairs (as returned by HGETALL) or nil
]]

-- TODO(features): implement group state retrieval
-- Steps:
--   1. HGETALL KEYS[1]
--   2. If empty (group not found), return nil
--   3. Return flat field-value array

local data = redis.call("HGETALL", KEYS[1])
if #data == 0 then
  return nil
end
return data
