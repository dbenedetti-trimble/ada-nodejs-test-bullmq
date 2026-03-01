--[[
  Tracks the completion of a single compensation job and transitions the group
  to its terminal state when all compensation jobs have finished.

  KEYS[1] group hash key    {prefix}:{queueName}:groups:{groupId}
  KEYS[2] events stream key {prefix}:{queueName}:events

  ARGV[1] compensation job key
  ARGV[2] outcome: "success" | "failure"
  ARGV[3] timestamp (epoch ms)
  ARGV[4] group ID
]]

local groupHashKey = KEYS[1]
local eventsKey    = KEYS[2]

local compJobKey  = ARGV[1]
local outcome     = ARGV[2]
local timestamp   = tonumber(ARGV[3])
local groupId     = ARGV[4]

-- TODO(features): implement:
--   1. HINCRBY groupHashKey "compensationCompleted" 1
--   2. If outcome == "failure": set a "compensationFailed" flag
--   3. Compare compensationCompleted against totalCompensationJobs (stored in group hash)
--   4. When all done:
--        If any compensation failed: set state=FAILED_COMPENSATION
--        Else: set state=FAILED
--        XADD group:failed event with groupId, groupName, state
-- Return: final group state string, or nil if compensation not yet complete

return nil
