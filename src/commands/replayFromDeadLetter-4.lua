--[[
  Replays a job from the dead letter queue back to its original source queue.

  Input:
    KEYS[1] DLQ job hash key
    KEYS[2] DLQ waiting key
    KEYS[3] source waiting key
    KEYS[4] source job hash key (new job)

    ARGV[1] DLQ job ID
    ARGV[2] new job ID for the source queue
    ARGV[3] timestamp

  Output:
    New job ID on success
    Negative error code on failure:
      -1 DLQ job not found
      -2 No _dlqMeta found in job data
]]
local rcall = redis.call

local dlqJobKey = KEYS[1]

if rcall("EXISTS", dlqJobKey) ~= 1 then
  return -1
end

local jobData = rcall("HGETALL", dlqJobKey)

local name = ""
local data = "{}"
local opts = "{}"
local timestamp = ARGV[3]

for i = 1, #jobData, 2 do
  local field = jobData[i]
  local value = jobData[i + 1]
  if field == "name" then
    name = value
  elseif field == "data" then
    data = value
  elseif field == "opts" then
    opts = value
  elseif field == "timestamp" then
    timestamp = value
  end
end

local parsedData = cjson.decode(data)
local dlqMeta = parsedData["_dlqMeta"]
if not dlqMeta then
  return -2
end

parsedData["_dlqMeta"] = nil
local cleanData = cjson.encode(parsedData)

local originalOpts = dlqMeta["originalOpts"]
if not originalOpts then
  originalOpts = cjson.decode(opts)
end
local newOpts = cjson.encode(originalOpts)

local newJobId = ARGV[2]
local newJobKey = KEYS[4]

rcall("HMSET", newJobKey,
  "name", name,
  "data", cleanData,
  "opts", newOpts,
  "timestamp", ARGV[3],
  "delay", 0,
  "priority", originalOpts["priority"] or 0,
  "atm", 0,
  "ats", 0)

rcall("LPUSH", KEYS[3], newJobId)

rcall("LREM", KEYS[2], -1, ARGV[1])
rcall("DEL", dlqJobKey, dlqJobKey .. ':logs',
  dlqJobKey .. ':dependencies', dlqJobKey .. ':processed',
  dlqJobKey .. ':failed', dlqJobKey .. ':unsuccessful')

return newJobId
