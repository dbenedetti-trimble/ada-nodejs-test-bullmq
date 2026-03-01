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

local jobIds = rcall("LRANGE", KEYS[1], 0, -1)
local count = 0
local nameFilter = ARGV[3]
local prefix = ARGV[1]
local dlqQueueName = ARGV[2]

for _, jobId in ipairs(jobIds) do
  local shouldRemove = true

  if nameFilter ~= "" then
    local jobKey = prefix .. ":" .. dlqQueueName .. ":" .. jobId
    local jobName = rcall("HGET", jobKey, "name")
    if jobName ~= nameFilter then
      shouldRemove = false
    end
  end

  if shouldRemove then
    local jobKey = prefix .. ":" .. dlqQueueName .. ":" .. jobId
    removeJobKeys(jobKey)
    rcall("LREM", KEYS[1], 0, jobId)
    count = count + 1
  end
end

return count
