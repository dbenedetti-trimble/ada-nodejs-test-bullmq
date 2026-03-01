--[[
  Cancels all pending/waiting/delayed/prioritized jobs in a group.
  Atomically transitions group state and updates counts.

  Input:
    KEYS[1] group hash key        ({prefix}:{queueName}:groups:{groupId})
    KEYS[2] group jobs hash key   ({prefix}:{queueName}:groups:{groupId}:jobs)
    KEYS[3] events stream key     ({prefix}:{queueName}:events)

    ARGV[1] msgpacked arguments:
      [1] timestamp (epoch ms)
      [2] groupId

  Output (msgpacked table):
    cancelled: count of cancelled jobs
    completedJobsForCompensation: array of { fullJobKey, jobName, returnValue }
    error: nil | error code (if group is in non-cancellable state)
      -1: group not found
      -2: group already COMPLETED
      -3: group already in terminal/compensating state
]]

-- TODO(features): implement cancellation logic
-- Stub returns empty result for scaffold.

local rcall = redis.call

return cmsgpack.pack({ cancelled = 0, completedJobsForCompensation = {}, error = nil })
