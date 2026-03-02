--[[
  Purge jobs from a dead letter queue with optional filtering.

  Input:
    KEYS[1] DLQ waiting list key
    KEYS[2] DLQ queue prefix key

    ARGV[1] filter name (empty string for no filter)
    ARGV[2] filter failedReason substring (empty string for no filter)

  Output:
    Number of removed jobs

  Events:
    None
]]
local rcall = redis.call

-- TODO: Implement in features pass
return 0
