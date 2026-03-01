--[[
  Atomically moves a terminally-failed job from the source queue's active list
  to the dead letter queue's waiting list, preserving full failure metadata.

  A job reaches this script only when:
    - retries are exhausted (attemptsMade >= maxAttempts), OR
    - the processor threw an UnrecoverableError.

  The source queue's failed sorted set is NOT written; the DLQ waiting list
  receives the job instead.

    Input:
      KEYS[1]  sourceActive       - source queue active list
      KEYS[2]  sourceJobHash      - source queue job hash  (bull:{queue}:{jobId})
      KEYS[3]  sourceEvents       - source queue events stream
      KEYS[4]  dlqWait            - DLQ queue waiting list (bull:{dlq}:wait)
      KEYS[5]  dlqJobHash         - DLQ queue job hash     (bull:{dlq}:{dlqJobId})
      KEYS[6]  dlqEvents          - DLQ queue events stream
      KEYS[7]  sourceMeta         - source queue meta key  (bull:{queue}:meta)

      ARGV[1]  jobId              - source job ID
      ARGV[2]  dlqJobId           - pre-generated UUID for the new DLQ job
      ARGV[3]  dlqMeta            - JSON-encoded DeadLetterMetadata
      ARGV[4]  timestamp          - current timestamp (ms, as string)
      ARGV[5]  removeOnFail       - '1' to remove source job hash, '0' to keep
      ARGV[6]  queueKeyPrefix     - key prefix for the source queue (e.g. "bull:payments:")
      ARGV[7]  dlqQueueName       - DLQ queue name string

    Output:
      dlqJobId string on success
      -1 if the source job hash does not exist
      -3 if the job is not found in the source active list

    Events emitted:
      source events stream: 'deadLettered' { jobId, deadLetterQueue, failedReason }
      DLQ events stream:    'waiting'      { jobId }
]]

local sourceActive  = KEYS[1]
local sourceJobHash = KEYS[2]
local sourceEvents  = KEYS[3]
local dlqWait       = KEYS[4]
local dlqJobHash    = KEYS[5]
local dlqEvents     = KEYS[6]
-- KEYS[7] = sourceMeta (reserved for future meta checks)

local jobId          = ARGV[1]
local dlqJobId       = ARGV[2]
local dlqMetaJson    = ARGV[3]
local timestamp      = ARGV[4]
local removeOnFail   = ARGV[5]
local queueKeyPrefix = ARGV[6]
local dlqQueueName   = ARGV[7]

-- 1. Fetch source job hash (guard -1 if missing)
local rawFields = redis.call('HGETALL', sourceJobHash)
if #rawFields == 0 then
  return -1
end

-- Convert flat array to table
local jobHash = {}
for i = 1, #rawFields, 2 do
  jobHash[rawFields[i]] = rawFields[i + 1]
end

-- 2. LREM source active list (guard -3 if not found)
local removed = redis.call('LREM', sourceActive, 0, jobId)
if removed == 0 then
  return -3
end

-- 3. Construct DLQ job data: embed _dlqMeta into the existing data JSON
local originalData = jobHash['data'] or '{}'
local dlqData
if originalData == '{}' then
  dlqData = '{"_dlqMeta":' .. dlqMetaJson .. '}'
else
  -- Append _dlqMeta before the closing brace of the JSON object
  dlqData = string.sub(originalData, 1, -2) .. ',"_dlqMeta":' .. dlqMetaJson .. '}'
end

-- 4. Build DLQ job hash fields (copy source fields, override specific keys)
local dlqFields = {}
local skipFields = {
  data = true,
  attemptsMade = true,
  finishedOn = true,
  processedOn = true,
  returnvalue = true,
  failedReason = true,
  stacktrace = true,
}
for k, v in pairs(jobHash) do
  if not skipFields[k] then
    table.insert(dlqFields, k)
    table.insert(dlqFields, v)
  end
end
table.insert(dlqFields, 'data')
table.insert(dlqFields, dlqData)
table.insert(dlqFields, 'attemptsMade')
table.insert(dlqFields, 0)

redis.call('HSET', dlqJobHash, unpack(dlqFields))

-- 5. LPUSH DLQ wait list
redis.call('LPUSH', dlqWait, dlqJobId)

-- 6. XADD source events 'deadLettered'
local dlqMeta = cjson.decode(dlqMetaJson)
local failedReason = dlqMeta['failedReason'] or ''
redis.call('XADD', sourceEvents, '*',
  'event', 'deadLettered',
  'jobId', jobId,
  'deadLetterQueue', dlqQueueName,
  'failedReason', failedReason)

-- 7. XADD DLQ events 'waiting'
redis.call('XADD', dlqEvents, '*',
  'event', 'waiting',
  'jobId', dlqJobId)

-- 8. Conditionally remove source job hash
if removeOnFail == '1' then
  redis.call('DEL', sourceJobHash)
end

return dlqJobId
