--[[
  Atomically replays a dead-lettered job back to its original source queue.

  Steps:
    1. Read the DLQ job hash.
    2. Extract _dlqMeta to determine sourceQueue and original data.
    3. Strip _dlqMeta from job data.
    4. Create a new job hash in the source queue keyspace (reset attemptsMade to 0).
    5. LPUSH the new job ID to the source queue's waiting list.
    6. LREM the DLQ job from the DLQ waiting list.
    7. DEL the DLQ job hash.
    8. Emit a 'waiting' event on the source queue events stream.
    9. Return the new job ID.

    Input:
      KEYS[1]  dlqJobHash         - DLQ job hash key       (bull:{dlq}:{dlqJobId})
      KEYS[2]  dlqWait            - DLQ waiting list        (bull:{dlq}:wait)
      KEYS[3]  sourceWait         - source queue wait list  (bull:{sourceQueue}:wait)
      KEYS[4]  sourceJobHash      - source job hash key     (bull:{sourceQueue}:{newJobId})

      ARGV[1]  dlqJobId           - DLQ job ID to replay
      ARGV[2]  newJobId           - pre-generated UUID for the replayed job in source queue
      ARGV[3]  timestamp          - current timestamp (ms)
      ARGV[4]  sourceQueuePrefix  - key prefix for the source queue (e.g. "bull:sourceQueue:")

    Output:
      newJobId string on success
      -1 if the DLQ job hash does not exist
]]

local dlqJobHash   = KEYS[1]
local dlqWait      = KEYS[2]
local sourceWait   = KEYS[3]
local sourceHash   = KEYS[4]

local dlqJobId          = ARGV[1]
local newJobId          = ARGV[2]
local timestamp         = ARGV[3]
local sourceQueuePrefix = ARGV[4]

-- 1. HGETALL DLQ job hash
local rawFields = redis.call('HGETALL', dlqJobHash)
if #rawFields == 0 then
  return -1
end

-- Convert flat array to table
local dlqHash = {}
for i = 1, #rawFields, 2 do
  dlqHash[rawFields[i]] = rawFields[i + 1]
end

-- 2. Extract and strip _dlqMeta from data.
-- If the original data was a JSON array or primitive it was wrapped as
-- {__originalData: <value>, _dlqMeta: {...}} — unwrap it on replay.
local dataJson = dlqHash['data'] or '{}'
local data = cjson.decode(dataJson)
data['_dlqMeta'] = nil
local newDataJson
if data['__originalData'] ~= nil then
  newDataJson = cjson.encode(data['__originalData'])
else
  newDataJson = cjson.encode(data)
end

-- 3. Build source job hash fields (copy DLQ fields, override specific keys)
local sourceFields = {}
local skipFields = {
  data = true,
  attemptsMade = true,
  finishedOn = true,
  processedOn = true,
  returnvalue = true,
  failedReason = true,
  stacktrace = true,
  timestamp = true,
}
for k, v in pairs(dlqHash) do
  if not skipFields[k] then
    table.insert(sourceFields, k)
    table.insert(sourceFields, v)
  end
end
table.insert(sourceFields, 'data')
table.insert(sourceFields, newDataJson)
table.insert(sourceFields, 'attemptsMade')
table.insert(sourceFields, 0)
table.insert(sourceFields, 'timestamp')
table.insert(sourceFields, timestamp)

-- 4. HSET source job hash
redis.call('HSET', sourceHash, unpack(sourceFields))

-- 5. LPUSH source wait list
redis.call('LPUSH', sourceWait, newJobId)

-- 6. LREM DLQ wait list
redis.call('LREM', dlqWait, 0, dlqJobId)

-- 7. DEL DLQ job hash
redis.call('DEL', dlqJobHash)

-- 8. Emit 'waiting' event on source queue events stream
local sourceEventsKey = sourceQueuePrefix .. 'events'
redis.call('XADD', sourceEventsKey, '*',
  'event', 'waiting',
  'jobId', newJobId)

return newJobId
