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

local jobIds = rcall("LRANGE", KEYS[1], 0, -1)
local count = 0

local filter = {}
if ARGV[1] and ARGV[1] ~= "" then
  filter = cmsgpack.unpack(ARGV[1])
end

local filterName = filter["name"]
local filterReason = filter["failedReason"]
local hasFilter = filterName ~= nil or filterReason ~= nil

-- Derive the key prefix by stripping ':wait' from the end of KEYS[1]
local keyPrefix = string.gsub(KEYS[1], ":wait$", "")

for _, jobId in ipairs(jobIds) do
  local jobHashKey = keyPrefix .. ":" .. jobId

  if hasFilter then
    local fields = rcall("HMGET", jobHashKey, "name", "data")
    local jobName = fields[1]
    local jobData = fields[2]

    local matches = true

    if filterName ~= nil and jobName ~= filterName then
      matches = false
    end

    if matches and filterReason ~= nil then
      local dataTable = cjson.decode(jobData or "{}")
      local dlqMeta = dataTable["_dlqMeta"]
      if dlqMeta == nil then
        matches = false
      else
        local reason = string.lower(dlqMeta["failedReason"] or "")
        local searchTerm = string.lower(filterReason)
        if string.find(reason, searchTerm, 1, true) == nil then
          matches = false
        end
      end
    end

    if matches then
      rcall("DEL", jobHashKey)
      rcall("LREM", KEYS[1], -1, jobId)
      count = count + 1
    end
  else
    rcall("DEL", jobHashKey)
    count = count + 1
  end
end

if not hasFilter then
  rcall("DEL", KEYS[1])
end

return count
