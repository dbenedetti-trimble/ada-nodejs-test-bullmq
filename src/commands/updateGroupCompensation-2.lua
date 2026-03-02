--[[
  Track compensation job completion and transition to terminal state.
  Called after each compensation job finishes.

  Input:
    KEYS[1] group hash key ({prefix}:{queueName}:groups:{groupId})
    KEYS[2] event stream key ({prefix}:{queueName}:events)

    ARGV[1] compensation job key
    ARGV[2] success or failure ("success" | "failure")
    ARGV[3] timestamp (epoch ms)

  Output:
    nil    - more compensation jobs pending
    string - terminal state ("FAILED" or "FAILED_COMPENSATION")
]]
-- TODO: implement in features pass
return nil
