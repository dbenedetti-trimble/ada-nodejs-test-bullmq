--[[
  Purge jobs from the DLQ wait list, optionally filtered by name and/or failedReason.

  Input:
    KEYS[1]  DLQ wait key
    KEYS[2]  DLQ job hash key prefix (used to construct per-job hash keys)

    ARGV[1]  filter name (empty string = no filter)
    ARGV[2]  filter failedReason substring (empty string = no filter)
    ARGV[3]  key prefix (e.g. "bull:payments-dlq:")

  Output:
    count  - number of jobs removed
]]

-- TODO(features): implement bulk purge with optional filtering
-- Stub: remove all jobs from wait list (no filtering) and return count
local rcall = redis.call

local filterName = ARGV[1]
local filterReason = ARGV[2]
local keyPrefix = ARGV[3]

local jobIds = rcall('LRANGE', KEYS[1], 0, -1)
local count = 0

for _, jobId in ipairs(jobIds) do
  local jobHashKey = keyPrefix .. jobId
  local name = rcall('HGET', jobHashKey, 'name') or ''
  local data = rcall('HGET', jobHashKey, 'data') or ''

  local nameMatch = filterName == '' or name == filterName
  -- TODO(features): parse data for failedReason substring match
  local reasonMatch = filterReason == ''

  if nameMatch and reasonMatch then
    rcall('DEL', jobHashKey)
    rcall('LREM', KEYS[1], -1, jobId)
    count = count + 1
  end
end

return count
