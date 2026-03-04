--[[
  Purges jobs from a dead letter queue, optionally filtering by name or failedReason.

  Input:
    KEYS[1] DLQ waiting key
    KEYS[2] DLQ meta key

    ARGV[1] optional filter name (empty string if none)
    ARGV[2] optional filter failedReason substring (empty string if none)

  Output:
    Count of removed jobs
]]

-- TODO: Implement in features pass
return 0
