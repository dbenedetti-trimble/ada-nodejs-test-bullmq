--[[
  Moves a job from the source queue's active list to a dead letter queue.

  Input:
    KEYS[1] source active key
    KEYS[2] source job hash key
    KEYS[3] source events stream
    KEYS[4] DLQ waiting key
    KEYS[5] DLQ job hash key
    KEYS[6] DLQ events stream
    KEYS[7] DLQ meta key

    ARGV[1] packed args (msgpack): dlqJobId, dlqJobData, jobId, sourceQueue,
            failedReason, timestamp, removeOnFail options, maxEvents

  Output:
    DLQ job ID on success
    Negative error code on failure
]]

-- TODO: Implement in features pass
return -99
