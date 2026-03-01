--[[
  Updates group state after a member job finishes (completed or failed).

  Called after moveToFinished completes for any job that has opts.group set.
  Atomically increments counters and determines if a group state transition
  should occur.

  Input:
    KEYS[1] group hash key        ({prefix}:{queueName}:groups:{groupId})
    KEYS[2] group jobs hash key   ({prefix}:{queueName}:groups:{groupId}:jobs)
    KEYS[3] event stream key      ({prefix}:{queueName}:events)

    ARGV[1] job key (e.g. "bull:payments:1")
    ARGV[2] new status: "completed" | "failed"
    ARGV[3] timestamp (epoch ms)
    ARGV[4] return value JSON (only relevant when status=completed)

  Output:
    Array: [action, completedJobsJson]
      action: "none" | "completed" | "trigger-compensation"
      completedJobsJson: JSON array of {jobKey, jobName, returnValue, jobId} for completed jobs
                         (only populated when action="trigger-compensation")
]]

local groupHashKey = KEYS[1]
local groupJobsKey = KEYS[2]
local eventsKey = KEYS[3]

local jobKey = ARGV[1]
local status = ARGV[2]
local timestamp = ARGV[3]

local rcall = redis.call

-- 1. Check if group exists; return "none" if not
if rcall("EXISTS", groupHashKey) == 0 then
  return {"none", "[]"}
end

-- 2. HSET group jobs hash: for completed, embed return value so siblings can
--    read it without cross-key HGET calls. Format: "completed:<returnValueJson>"
if status == "completed" then
  rcall("HSET", groupJobsKey, jobKey, "completed:" .. (ARGV[4] or "null"))
else
  rcall("HSET", groupJobsKey, jobKey, status)
end

local data = rcall("HMGET", groupHashKey,
  "state", "totalJobs", "completedCount", "id", "name")
local currentState = data[1]
local totalJobs = tonumber(data[2])
local groupId = data[4]
local groupName = data[5]

-- 3. Handle completed status
if status == "completed" then
  local newCompleted = tonumber(rcall("HINCRBY", groupHashKey, "completedCount", 1))
  if newCompleted == totalJobs and currentState == "ACTIVE" then
    rcall("HSET", groupHashKey, "state", "COMPLETED", "updatedAt", timestamp)
    rcall("XADD", eventsKey, "*",
      "event", "group:completed",
      "groupId", groupId,
      "groupName", groupName
    )
    return {"completed", "[]"}
  end

-- 4. Handle failed status
elseif status == "failed" then
  rcall("HINCRBY", groupHashKey, "failedCount", 1)

  if currentState == "ACTIVE" then
    rcall("HSET", groupHashKey, "state", "COMPENSATING", "updatedAt", timestamp)

    -- Collect all completed jobs with their names and return values.
    -- Return values are embedded in the group jobs hash (see completed branch above)
    -- to avoid cross-key HGET calls that fail in Redis Cluster.
    local allJobs = rcall("HGETALL", groupJobsKey)
    local completedJobs = {}
    for i = 1, #allJobs, 2 do
      local jKey = allJobs[i]
      local jStatus = allJobs[i+1]
      if string.sub(jStatus, 1, 9) == "completed" then
        local jName = rcall("HGET", jKey, "name") or ""
        local jReturn = string.sub(jStatus, 11) -- extract after "completed:"
        if jReturn == "" then jReturn = "null" end
        local jId = string.match(jKey, ":([^:]+)$") or jKey
        table.insert(completedJobs, {
          jobKey = jKey,
          jobName = jName,
          returnValue = jReturn,
          jobId = jId
        })
      end
    end

    local completedJobsJson
    if #completedJobs == 0 then
      completedJobsJson = "[]"
    else
      completedJobsJson = cjson.encode(completedJobs)
    end
    local failedJobId = string.match(jobKey, ":([^:]+)$") or jobKey

    rcall("XADD", eventsKey, "*",
      "event", "group:compensating",
      "groupId", groupId,
      "groupName", groupName,
      "failedJobId", failedJobId,
      "reason", "job failed"
    )

    return {"trigger-compensation", completedJobsJson}
  end
end

-- 5. No state change
return {"none", "[]"}
