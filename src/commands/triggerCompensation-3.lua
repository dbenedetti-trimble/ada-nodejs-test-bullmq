--[[
  Enqueues compensation jobs for completed group members.
  Follows the addStandardJob pattern: increments job ID counter,
  creates job hash, and pushes to the compensation queue wait list.

  KEYS[1] compensation queue wait list key  {prefix}:{compQueueName}:wait
  KEYS[2] compensation queue meta key       {prefix}:{compQueueName}:meta
  KEYS[3] compensation queue events key     {prefix}:{compQueueName}:events

  ARGV[1] key prefix
  ARGV[2] msgpacked array of compensation job descriptors:
          Each entry: { jobId, name, data JSON, opts JSON }
]]

local waitKey   = KEYS[1]
local metaKey   = KEYS[2]
local eventsKey = KEYS[3]

local prefix          = ARGV[1]
local compensationJobs = ARGV[2]

-- TODO(features): implement:
--   Unpack ARGV[2] array of compensation job entries.
--   For each entry:
--     1. HINCRBY metaKey "id" 1 to get new job ID
--     2. HSET {prefix}:{compQueueName}:{jobId} with name, data, opts, timestamp
--     3. LPUSH waitKey jobId (FIFO insertion)
--     4. XADD eventsKey * event "added" jobId <id> name <name>
-- Return: number of compensation jobs enqueued

return 0
