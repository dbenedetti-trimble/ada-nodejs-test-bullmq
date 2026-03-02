--[[
  Enqueue compensation jobs atomically into compensation queues.

  Input:
    KEYS[1] compensation queue wait key
    KEYS[2] compensation queue meta key
    KEYS[3] compensation queue events stream key

    ARGV[1] JSON array of compensation job definitions
           Each element: { id, name, data, opts, queueBase }

  Output:
    number - count of compensation jobs created
]]
local waitKey = KEYS[1]
local metaKey = KEYS[2]
local eventStreamKey = KEYS[3]

local jobDefs = cjson.decode(ARGV[1])
local createdCount = 0

for i, jobDef in ipairs(jobDefs) do
  local jobId = jobDef["id"]
  local jobKey = jobDef["queueBase"] .. ":" .. jobId

  redis.call("HSET", jobKey,
    "name", jobDef["name"],
    "data", cjson.encode(jobDef["data"]),
    "opts", cjson.encode(jobDef["opts"] or {}),
    "timestamp", jobDef["timestamp"] or tostring(redis.call("TIME")[1] * 1000),
    "delay", 0,
    "priority", 0,
    "attemptsMade", 0,
    "attemptsStarted", 0,
    "stacktrace", "[]",
    "returnvalue", "null")

  redis.call("LPUSH", waitKey, jobId)
  createdCount = createdCount + 1

  redis.call("XADD", eventStreamKey, "*",
    "event", "waiting",
    "jobId", jobId)
end

return createdCount
