--[[
  Purge jobs from the DLQ wait list, optionally filtered by name and/or failedReason.
  The failedReason filter performs a case-insensitive substring match against
  _dlqMeta.failedReason embedded in the JSON data field.

  Input:
    KEYS[1]  DLQ wait key
    KEYS[2]  DLQ key prefix (used as a placeholder; actual prefix comes from ARGV[3])

    ARGV[1]  filter name (empty string = no name filter; exact match)
    ARGV[2]  filter failedReason substring (empty string = no reason filter; case-insensitive)
    ARGV[3]  key prefix (e.g. "bull:payments-dlq:")

  Output:
    count  - number of jobs removed
]]
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

  local reasonMatch = true
  if filterReason ~= '' then
    reasonMatch = false
    if data ~= '' then
      local ok, decodedData = pcall(cjson.decode, data)
      if ok and type(decodedData) == 'table' then
        local dlqMeta = decodedData['_dlqMeta']
        if dlqMeta and type(dlqMeta) == 'table' then
          local failedReason = tostring(dlqMeta['failedReason'] or '')
          if string.find(string.lower(failedReason), string.lower(filterReason), 1, true) then
            reasonMatch = true
          end
        end
      end
    end
  end

  if nameMatch and reasonMatch then
    rcall('DEL', jobHashKey)
    rcall('LREM', KEYS[1], -1, jobId)
    count = count + 1
  end
end

return count
