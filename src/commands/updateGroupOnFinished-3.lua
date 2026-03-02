--[[
  Update group state when a member job completes or fails.
  Called as a post-completion hook after moveToFinished.

  Input:
    KEYS[1] group hash key ({prefix}:{queueName}:groups:{groupId})
    KEYS[2] group jobs key ({prefix}:{queueName}:groups:{groupId}:jobs)
    KEYS[3] event stream key ({prefix}:{queueName}:events)

    ARGV[1] job key
    ARGV[2] new status ("completed" or "failed")
    ARGV[3] timestamp (epoch ms)
    ARGV[4] return value (if completed, empty string otherwise)

  Output:
    nil       - no state transition
    table     - { transition: string, completedJobs?: string[] }
                transition is "COMPLETED" or "COMPENSATING"
                completedJobs is present when transition is "COMPENSATING"
]]
-- TODO: implement in features pass
return nil
