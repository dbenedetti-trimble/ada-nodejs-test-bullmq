--[[
  Move job from source queue's active list to DLQ queue's waiting list on terminal failure.
  Atomic: removes from source active, creates DLQ job hash with _dlqMeta, pushes to DLQ wait,
  emits events on both queues, and optionally cleans up source job hash per removeOnFail.

  NOTE (Redis Cluster): All KEYS must hash to the same slot. Use matching hash tags on both
  the source queue name and the DLQ queue name (e.g. {payments} and {payments}-dlq).

    Input:
      KEYS[1]  source active list key
      KEYS[2]  source job hash key
      KEYS[3]  source events stream key
      KEYS[4]  DLQ wait list key
      KEYS[5]  DLQ job hash key
      KEYS[6]  DLQ events stream key
      KEYS[7]  DLQ meta key

      ARGV[1]  source job ID
      ARGV[2]  DLQ queue name
      ARGV[3]  DLQ job ID (new UUID)
      ARGV[4]  packed metadata (msgpack: DeadLetterMetadata fields)
      ARGV[5]  timestamp (ms)
      ARGV[6]  removeOnFail flag ('1' = remove source job hash, '' = keep)

    Output:
      DLQ job ID string on success
      -1  source job does not exist
      -3  job not in active set

    Events:
      source events stream: 'deadLettered' { jobId, deadLetterQueue }
      DLQ events stream:    'waiting'      { jobId }
]]
local rcall = redis.call

--- Includes
--- @include "includes/trimEvents"

if rcall("EXISTS", KEYS[2]) == 0 then
  return -1
end

local numRemovedElements = rcall("LREM", KEYS[1], -1, ARGV[1])
if numRemovedElements < 1 then
  return -3
end

local jobFields = rcall("HMGET", KEYS[2], "name", "data", "opts")
local jobName = jobFields[1]
local originalData = jobFields[2]
local jobOpts = jobFields[3]

local meta = cmsgpack.unpack(ARGV[4])

local dataTable = cjson.decode(originalData or "{}")
dataTable["_dlqMeta"] = meta
local newData = cjson.encode(dataTable)

rcall("HSET", KEYS[5],
  "name", jobName,
  "data", newData,
  "opts", jobOpts or "{}",
  "timestamp", ARGV[5],
  "delay", "0",
  "priority", "0",
  "atm", "0"
)

rcall("LPUSH", KEYS[4], ARGV[3])

trimEvents(KEYS[7], KEYS[6])

rcall("XADD", KEYS[3], "*", "event", "deadLettered", "jobId", ARGV[1], "deadLetterQueue", ARGV[2])
rcall("XADD", KEYS[6], "*", "event", "waiting", "jobId", ARGV[3])

if ARGV[6] == "1" then
  rcall("DEL", KEYS[2])
end

return ARGV[3]
