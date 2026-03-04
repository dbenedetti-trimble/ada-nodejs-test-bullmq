--[[
  Purges jobs from a dead letter queue, optionally filtering by name or failedReason.

  Input:
    KEYS[1] DLQ waiting key
    KEYS[2] DLQ meta key

    ARGV[1] optional filter name (empty string if none)
    ARGV[2] optional filter failedReason substring (empty string if none)
    ARGV[3] queue prefix (e.g. "bull:queueName:")

  Output:
    Count of removed jobs
]]
local rcall = redis.call

local waitKey = KEYS[1]
local filterName = ARGV[1]
local filterReason = ARGV[2]
local prefix = ARGV[3]

local jobIds = rcall("LRANGE", waitKey, 0, -1)
local removed = 0

for i = 1, #jobIds do
  local jobId = jobIds[i]
  local jobKey = prefix .. jobId

  local shouldRemove = true

  if filterName ~= "" or filterReason ~= "" then
    local jobFields = rcall("HMGET", jobKey, "name", "data")
    local jobName = jobFields[1] or ""
    local jobData = jobFields[2] or "{}"

    if filterName ~= "" and jobName ~= filterName then
      shouldRemove = false
    end

    if shouldRemove and filterReason ~= "" then
      local parsedData = cjson.decode(jobData)
      local dlqMeta = parsedData["_dlqMeta"]
      if dlqMeta then
        local reason = dlqMeta["failedReason"] or ""
        if not string.find(string.lower(reason), string.lower(filterReason), 1, true) then
          shouldRemove = false
        end
      else
        shouldRemove = false
      end
    end
  end

  if shouldRemove then
    rcall("LREM", waitKey, -1, jobId)
    rcall("DEL", jobKey, jobKey .. ':logs',
      jobKey .. ':dependencies', jobKey .. ':processed',
      jobKey .. ':failed', jobKey .. ':unsuccessful')
    removed = removed + 1
  end
end

return removed
