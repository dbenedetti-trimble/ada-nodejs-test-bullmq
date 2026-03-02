--[[
  Purge jobs from a dead letter queue with optional filtering.

  Input:
    KEYS[1] DLQ waiting list key
    KEYS[2] DLQ queue prefix key

    ARGV[1] filter name (empty string for no filter)
    ARGV[2] filter failedReason substring (empty string for no filter)

  Output:
    Number of removed jobs

  Events:
    None
]]
local rcall = redis.call

local dlqWaitKey   = KEYS[1]
local dlqPrefix    = KEYS[2]

local filterName   = ARGV[1]
local filterReason = ARGV[2]

local jobIds = rcall("LRANGE", dlqWaitKey, 0, -1)
local removed = 0

for i, jobId in ipairs(jobIds) do
  local jobKey = dlqPrefix .. jobId
  local matches = true

  if filterName ~= "" or filterReason ~= "" then
    if filterName ~= "" then
      local name = rcall("HGET", jobKey, "name") or ""
      if name ~= filterName then
        matches = false
      end
    end

    if matches and filterReason ~= "" then
      local data = rcall("HGET", jobKey, "data") or "{}"
      local decoded = cjson.decode(data)
      local meta = decoded["_dlqMeta"]
      if meta then
        local reason = meta["failedReason"] or ""
        if not string.find(string.lower(reason), string.lower(filterReason)) then
          matches = false
        end
      else
        matches = false
      end
    end
  end

  if matches then
    rcall("LREM", dlqWaitKey, 1, jobId)
    rcall("DEL", jobKey)
    local logsKey = jobKey .. ":logs"
    rcall("DEL", logsKey)
    removed = removed + 1
  end
end

return removed
