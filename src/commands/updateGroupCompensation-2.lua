--[[
  Tracks completion of a compensation job and transitions group to terminal state
  when all compensations are done.

  Input:
    KEYS[1] group hash key    ({prefix}:{queueName}:groups:{groupId})
    KEYS[2] events stream key ({prefix}:{queueName}:events)

    ARGV[1] msgpacked arguments:
      [1] groupId
      [2] compensationJobKey  (fully qualified key of the compensation job)
      [3] finalStatus         ("completed" | "failed")
      [4] timestamp           (epoch ms)

  Output (msgpacked table):
    groupState: new group state string ("FAILED" | "FAILED_COMPENSATION" | "COMPENSATING")
    allDone: boolean (true when group has reached terminal state)
]]

-- TODO(features): implement compensation tracking and terminal state transition
-- Stub returns no-op for scaffold.

local rcall = redis.call

return cmsgpack.pack({ groupState = "COMPENSATING", allDone = false })
