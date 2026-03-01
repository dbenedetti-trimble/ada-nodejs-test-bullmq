--[[
  Called after a group member job moves to its final state (completed or failed).
  Atomically updates group job status, increments counters, and triggers state
  transitions. Returns a table describing the resulting transition so the caller
  (Worker) can enqueue compensation jobs if needed.

  KEYS[1] group hash key    {prefix}:{queueName}:groups:{groupId}
  KEYS[2] group jobs key    {prefix}:{queueName}:groups:{groupId}:jobs
  KEYS[3] events stream key {prefix}:{queueName}:events

  ARGV[1] job key (fully-qualified: {prefix}:{jobQueueName}:{jobId})
  ARGV[2] new status: "completed" | "failed"
  ARGV[3] timestamp (epoch ms)
  ARGV[4] return value JSON (may be empty string for failed jobs)
]]

local groupHashKey = KEYS[1]
local groupJobsKey = KEYS[2]
local eventsKey    = KEYS[3]

local jobKey      = ARGV[1]
local newStatus   = ARGV[2]
local timestamp   = tonumber(ARGV[3])
local returnValue = ARGV[4]

-- TODO(features): implement:
--   1. HSET groupJobsKey jobKey newStatus
--   2. HINCRBY completedCount or failedCount on groupHashKey
--   3. If completedCount == totalJobs: set state=COMPLETED, XADD group:completed event
--   4. If newStatus=="failed" and state=="ACTIVE":
--        set state=COMPENSATING, XADD group:compensating event,
--        return { trigger="compensation", completedJobKeys=[] }
--   Idempotent: no-op if already in COMPLETED or COMPENSATING.
-- Return: nil (no compensation needed) or table with trigger info.

return nil
