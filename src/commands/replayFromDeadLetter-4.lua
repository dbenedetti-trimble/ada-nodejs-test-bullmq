--[[
  Replay a job from the dead letter queue back to its source queue.

  Input:
    KEYS[1] DLQ job hash key
    KEYS[2] DLQ waiting list key
    KEYS[3] source queue waiting list key
    KEYS[4] source queue ID counter key

    ARGV[1] DLQ job id
    ARGV[2] source queue prefix
    ARGV[3] timestamp

  Output:
    New job ID (string) on success
   -1 - Job not found in DLQ.

  Events:
    - 'waiting' on source queue events stream
]]
local rcall = redis.call

local dlqJobKey       = KEYS[1]
local dlqWaitKey      = KEYS[2]
local srcWaitKey      = KEYS[3]
local srcIdKey        = KEYS[4]

local dlqJobId        = ARGV[1]
local srcPrefix       = ARGV[2]
local timestamp       = ARGV[3]

if rcall("EXISTS", dlqJobKey) ~= 1 then
  return -1
end

local jobData = rcall("HGET", dlqJobKey, "data") or "{}"
local jobName = rcall("HGET", dlqJobKey, "name") or ""
local jobOptsRaw = rcall("HGET", dlqJobKey, "opts") or "{}"

local data = cjson.decode(jobData)
local dlqMeta = data["_dlqMeta"]

if not dlqMeta then
  return -1
end

data["_dlqMeta"] = nil
local cleanData = cjson.encode(data)

local originalOpts = dlqMeta["originalOpts"]
if not originalOpts then
  originalOpts = cjson.decode(jobOptsRaw)
end
local optsJson = cjson.encode(originalOpts)

local newJobId = rcall("INCR", srcIdKey)
local newJobKey = srcPrefix .. newJobId

rcall("HMSET", newJobKey,
  "name", jobName,
  "data", cleanData,
  "opts", optsJson,
  "timestamp", timestamp,
  "delay", 0,
  "priority", originalOpts["priority"] or 0,
  "attemptsMade", 0,
  "atm", 0)

rcall("RPUSH", srcWaitKey, newJobId)

local srcEventsKey = srcPrefix .. "events"
rcall("XADD", srcEventsKey, "*",
  "event", "waiting",
  "jobId", tostring(newJobId))

rcall("LREM", dlqWaitKey, 1, dlqJobId)
rcall("DEL", dlqJobKey)

return tostring(newJobId)
