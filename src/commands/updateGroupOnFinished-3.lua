--[[
  Updates group state after a member job finishes (completed or failed).

  Called after moveToFinished completes for any job that has opts.group set.
  Atomically increments counters and determines if a group state transition
  should occur.

  Input:
    KEYS[1] group hash key        ({prefix}:{queueName}:groups:{groupId})
    KEYS[2] group jobs hash key   ({prefix}:{queueName}:groups:{groupId}:jobs)
    KEYS[3] event stream key      ({prefix}:{queueName}:events)

    ARGV[1] job key (e.g. "bull:payments:1")
    ARGV[2] new status: "completed" | "failed"
    ARGV[3] timestamp (epoch ms)
    ARGV[4] return value JSON (only relevant when status=completed)

  Output:
    Array: [action, completedJobsJson]
      action: "none" | "completed" | "trigger-compensation"
      completedJobsJson: JSON array of {jobKey, returnValue} for completed jobs
                         (only populated when action="trigger-compensation")
]]

-- TODO(features): implement group-on-finished state machine
-- Steps:
--   1. Check if group exists; return "none" if not
--   2. HSET group jobs hash: jobKey = new status
--   3. If status == "completed":
--        HINCRBY completedCount
--        If completedCount == totalJobs and group state == "ACTIVE":
--          HSET state = "COMPLETED", updatedAt = timestamp
--          XADD group:completed event {groupId, groupName}
--          return ["completed", "[]"]
--   4. If status == "failed":
--        HINCRBY failedCount
--        If group state == "ACTIVE":
--          HSET state = "COMPENSATING", updatedAt = timestamp
--          Collect all completed jobs from group jobs hash
--          XADD group:compensating event {groupId, groupName, failedJobId, reason}
--          return ["trigger-compensation", completedJobsJson]
--   5. Otherwise return ["none", "[]"]

return {"none", "[]"}
