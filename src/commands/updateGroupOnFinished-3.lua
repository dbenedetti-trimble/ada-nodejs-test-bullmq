--[[
  Called after moveToFinished completes for a group member job.
  Increments the appropriate counter, checks for terminal state, and emits events.

  Input:
    KEYS[1] group hash key        ({prefix}:{queueName}:groups:{groupId})
    KEYS[2] group jobs hash key   ({prefix}:{queueName}:groups:{groupId}:jobs)
    KEYS[3] events stream key     ({prefix}:{queueName}:events)

    ARGV[1] msgpacked arguments:
      [1] fullJobKey   (fully qualified job key)
      [2] newStatus    ("completed" | "failed")
      [3] timestamp    (epoch ms)
      [4] returnValue  (JSON string, only for completed)

  Output (msgpacked table):
    action: "none" | "cancel_and_compensate"
    completedJobsForCompensation: array of { fullJobKey, jobName, returnValue }
    groupState: new group state string
]]

-- TODO(features): implement group state transition logic
-- Stub returns no-op action for scaffold.

local rcall = redis.call

return cmsgpack.pack({ action = "none", completedJobsForCompensation = {}, groupState = "ACTIVE" })
