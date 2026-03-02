--[[
  Cancel pending/waiting/delayed jobs in a group.
  Used during compensation trigger or manual group cancellation.

  Input:
    KEYS[1] group hash key ({prefix}:{queueName}:groups:{groupId})
    KEYS[2] group jobs key ({prefix}:{queueName}:groups:{groupId}:jobs)
    KEYS[3] event stream key ({prefix}:{queueName}:events)

    ARGV[1] timestamp (epoch ms)
    ARGV[2] group ID
    ARGV[3] prefix

  Output:
    number - count of cancelled jobs
]]
-- TODO: implement in features pass
return 0
