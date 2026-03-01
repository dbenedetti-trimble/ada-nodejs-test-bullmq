--[[
  Cancels all pending/waiting/delayed jobs in a group.
  Iterates the group jobs hash and removes pending entries from their
  respective queue sets (wait list, delayed ZSET, prioritized ZSET).
  Updates the group state to COMPENSATING or FAILED depending on whether
  any completed jobs exist.

  KEYS[1] group hash key    {prefix}:{queueName}:groups:{groupId}
  KEYS[2] group jobs key    {prefix}:{queueName}:groups:{groupId}:jobs
  KEYS[3] events stream key {prefix}:{queueName}:events

  ARGV[1] timestamp (epoch ms)
  ARGV[2] group ID
]]

local groupHashKey = KEYS[1]
local groupJobsKey = KEYS[2]
local eventsKey    = KEYS[3]

local timestamp = tonumber(ARGV[1])
local groupId   = ARGV[2]

-- TODO(features): implement:
--   1. HGETALL groupJobsKey to iterate all job entries
--   2. For each "pending" entry: LREM wait list, ZREM delayed set, ZREM prioritized set
--   3. HSET entry to "cancelled", HINCRBY cancelledCount
--   4. If completedCount > 0: set state=COMPENSATING, XADD group:compensating event
--      Else: set state=FAILED, XADD group:failed event
-- Return: list of completed job keys that need compensation jobs

return {}
