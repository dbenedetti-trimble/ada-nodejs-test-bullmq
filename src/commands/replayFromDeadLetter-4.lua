--[[
  Replays a job from the dead letter queue back to its original source queue.

  Input:
    KEYS[1] DLQ job hash key
    KEYS[2] DLQ waiting key
    KEYS[3] source waiting key
    KEYS[4] source job hash key (new job)

    ARGV[1] DLQ job ID
    ARGV[2] new job ID for the source queue
    ARGV[3] timestamp

  Output:
    New job ID on success
    Negative error code on failure
]]

-- TODO: Implement in features pass
return -99
