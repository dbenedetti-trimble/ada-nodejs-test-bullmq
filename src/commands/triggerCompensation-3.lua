--[[
  Enqueues compensation jobs for completed group members.
  Follows the addStandardJob pattern: increments job ID counter,
  creates job hash, and pushes to the compensation queue wait list.

  KEYS[1] compensation queue wait list key  {prefix}:{compQueueName}:wait
  KEYS[2] compensation queue meta key       {prefix}:{compQueueName}:meta
  KEYS[3] compensation queue events key     {prefix}:{compQueueName}:events

  ARGV[1] key prefix (e.g. "bull")
  ARGV[2] msgpacked array of compensation job descriptors.
          Each entry is a table: { name, dataJson, optsJson, timestamp }
]]

local waitKey   = KEYS[1]
local metaKey   = KEYS[2]
local eventsKey = KEYS[3]

local prefix = ARGV[1]

-- Derive the id counter key and base job key from the wait key
-- waitKey pattern: {prefix}:{compQueueName}:wait
local idKey      = waitKey:gsub(":wait$", ":id")
local baseJobKey = waitKey:gsub(":wait$", ":")

local compensationJobs = cmsgpack.unpack(ARGV[2])

local maxEvents = tonumber(redis.call("HGET", metaKey, "mx") or 10000)
if not maxEvents or maxEvents <= 0 then
  maxEvents = 10000
end

local count = 0
for i = 1, #compensationJobs do
  local job = compensationJobs[i]
  local jobId = redis.call("INCR", idKey)
  local jobKey = baseJobKey .. jobId

  redis.call("HMSET", jobKey,
    "name",      job[1],
    "data",      job[2],
    "opts",      job[3],
    "timestamp", job[4]
  )

  redis.call("LPUSH", waitKey, jobId)
  redis.call("XADD", eventsKey, "MAXLEN", "~", maxEvents, "*",
    "event", "waiting",
    "jobId", jobId
  )
  count = count + 1
end

return count
