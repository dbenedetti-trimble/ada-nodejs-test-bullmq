--[[
  Bulk remove jobs from the DLQ waiting list with an optional name filter.

  Iterates the DLQ waiting list, optionally filters by job name, removes
  matching job hashes and list entries.

  Note: failedReason filtering is handled at the TypeScript layer (requires
  reading job data, which is more efficient outside Lua for large queues).

  Input:
    KEYS[1]  DLQ waiting list key   ({prefix}:{dlqQueue}:wait)
    KEYS[2]  DLQ meta key           ({prefix}:{dlqQueue}:meta)

    ARGV[1]  prefix (e.g. 'bull')
    ARGV[2]  dlqQueueName
    ARGV[3]  name filter (empty string = no filter, remove all)

  Output:
    count of removed jobs (number >= 0)
]]

local rcall = redis.call

--- @include "includes/removeJobKeys"
--- @include "includes/trimEvents"

-- TODO (features pass): implement bulk purge with optional name filter
-- Placeholder: return 0 until implemented
return 0
