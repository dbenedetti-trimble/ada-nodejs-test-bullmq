--[[
  Bulk remove DLQ jobs from the waiting list with optional name/failedReason filter.
  Scans all jobs in the DLQ wait list, applies AND filter (name exact match,
  failedReason case-insensitive substring), and DELetes matching job hashes + LREMs from list.

    Input:
      KEYS[1]  DLQ wait list key
      KEYS[2]  DLQ meta key

      ARGV[1]  packed filter (msgpack: { name?: string, failedReason?: string })
               empty/nil means remove all jobs

    Output:
      count of removed jobs (integer)
]]
local rcall = redis.call

-- TODO: implement business logic in features pass
-- Stub: return 0
return 0
