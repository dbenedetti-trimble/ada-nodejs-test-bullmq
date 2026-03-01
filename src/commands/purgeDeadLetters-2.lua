--[[
  Bulk-removes jobs from a dead letter queue's waiting list, with optional filtering.

  Steps:
    1. LRANGE the DLQ waiting list to get all job IDs.
    2. For each job ID:
         a. HGETALL the job hash.
         b. If filterName is non-empty, skip jobs whose name does not match exactly.
         c. If filterReason is non-empty, skip jobs whose _dlqMeta.failedReason
            does not contain filterReason (case-insensitive substring match).
         d. If the job matches: DEL hash, LREM from waiting list, increment count.
    3. Return the count of removed jobs.

    Input:
      KEYS[1]  dlqWait            - DLQ waiting list key   (bull:{dlq}:wait)
      KEYS[2]  dlqJobHashPrefix   - key prefix for DLQ job hashes (bull:{dlq}:)

      ARGV[1]  filterName         - exact job name to match, or empty string for all
      ARGV[2]  filterReason       - failedReason substring, or empty string for all

    Output:
      integer count of jobs removed
]]

local dlqWait          = KEYS[1]
local dlqJobHashPrefix = KEYS[2]

local filterName   = ARGV[1]
local filterReason = ARGV[2]

-- 1. Get all job IDs from DLQ wait list (snapshot)
local jobIds = redis.call('LRANGE', dlqWait, 0, -1)
local count = 0

-- 2. Process each job
for _, jobId in ipairs(jobIds) do
  local jobHashKey = dlqJobHashPrefix .. jobId
  local rawFields = redis.call('HGETALL', jobHashKey)

  if #rawFields > 0 then
    local jobHash = {}
    for i = 1, #rawFields, 2 do
      jobHash[rawFields[i]] = rawFields[i + 1]
    end

    local matches = true

    -- Filter by exact name
    if filterName ~= '' then
      if jobHash['name'] ~= filterName then
        matches = false
      end
    end

    -- Filter by failedReason substring (case-insensitive, from _dlqMeta)
    if matches and filterReason ~= '' then
      local dataJson = jobHash['data'] or '{}'
      local ok, data = pcall(cjson.decode, dataJson)
      if ok and data and data['_dlqMeta'] then
        local reason = string.lower(tostring(data['_dlqMeta']['failedReason'] or ''))
        if not string.find(reason, string.lower(filterReason), 1, true) then
          matches = false
        end
      else
        matches = false
      end
    end

    if matches then
      redis.call('DEL', jobHashKey)
      redis.call('LREM', dlqWait, 0, jobId)
      count = count + 1
    end
  end
end

return count
