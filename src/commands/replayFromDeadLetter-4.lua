--[[
  Atomically replay a DLQ job back to its original source queue.
  Reads DLQ job hash, strips _dlqMeta from data, creates a new job in the source queue,
  removes the DLQ job, and emits an event on the DLQ queue.

  NOTE (Redis Cluster): All KEYS must hash to the same slot. Use matching hash tags.

    Input:
      KEYS[1]  DLQ job hash key
      KEYS[2]  DLQ wait list key
      KEYS[3]  source wait list key
      KEYS[4]  source job hash key (for new job)

      ARGV[1]  DLQ job ID
      ARGV[2]  new source job ID (UUID)
      ARGV[3]  source queue name (for validation)
      ARGV[4]  timestamp (ms)

    Output:
      new source job ID string on success
      -1  DLQ job does not exist
      -2  _dlqMeta missing or sourceQueue not set

    Events:
      DLQ events stream:    'removed' { jobId }
]]
local rcall = redis.call

local jobFields = rcall("HGETALL", KEYS[1])
if #jobFields == 0 then
  return -1
end

local jobHash = {}
for i = 1, #jobFields, 2 do
  jobHash[jobFields[i]] = jobFields[i + 1]
end

local dataTable = cjson.decode(jobHash["data"] or "{}")
local dlqMeta = dataTable["_dlqMeta"]
if dlqMeta == nil or dlqMeta["sourceQueue"] == nil then
  return -2
end

dataTable["_dlqMeta"] = nil
local newData = cjson.encode(dataTable)

rcall("HSET", KEYS[4],
  "name", jobHash["name"] or "",
  "data", newData,
  "opts", jobHash["opts"] or "{}",
  "timestamp", ARGV[4],
  "delay", "0",
  "priority", "0",
  "atm", "0"
)

rcall("LPUSH", KEYS[3], ARGV[2])

rcall("DEL", KEYS[1])
rcall("LREM", KEYS[2], -1, ARGV[1])

return ARGV[2]
