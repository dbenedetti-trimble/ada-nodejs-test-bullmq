--[[
  Tracks compensation job completion and transitions group to terminal state.

  Called when a compensation job finishes (success or failure). When all
  compensation jobs are accounted for, transitions the group to FAILED or
  FAILED_COMPENSATION and emits the group:failed event.

  Input:
    KEYS[1] group hash key  ({prefix}:{queueName}:groups:{groupId})
    KEYS[2] event stream key ({prefix}:{queueName}:events)

    ARGV[1] compensation job key
    ARGV[2] compensation result: "success" | "failure"
    ARGV[3] timestamp (epoch ms)

  Output:
    New group state string, or "pending" if compensation is still in progress
]]

-- TODO(features): implement compensation tracking
-- Steps:
--   1. HGET group hash: state, totalCompensations, completedCompensations, failedCompensations
--   2. Increment completed or failed compensation counter based on ARGV[2]
--   3. If completedCompensations + failedCompensations == totalCompensations:
--        If failedCompensations > 0:
--          HSET state = "FAILED_COMPENSATION"
--        Else:
--          HSET state = "FAILED"
--        HSET updatedAt = timestamp
--        XADD event stream: group:failed event {groupId, groupName, state}
--        Return new state
--   4. Otherwise return "pending"

return "pending"
