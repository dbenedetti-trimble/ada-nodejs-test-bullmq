--[[
  Atomically creates a job group in Redis.

  Sets up group metadata hash, per-job status hash, and groups index ZSET.
  Transitions group state from PENDING to ACTIVE as part of creation.

  Input:
    KEYS[1] group hash key        ({prefix}:{queueName}:groups:{groupId})
    KEYS[2] group jobs hash key   ({prefix}:{queueName}:groups:{groupId}:jobs)
    KEYS[3] groups index ZSET key ({prefix}:{queueName}:groups)
    KEYS[4] event stream key      ({prefix}:{queueName}:events)

    ARGV[1] group ID
    ARGV[2] group name
    ARGV[3] timestamp (epoch ms)
    ARGV[4] total number of jobs
    ARGV[5] compensation JSON string
    ARGV[6..N] job keys (one per member job)

  Output:
    group ID on success
]]

-- TODO(features): implement atomic group creation
-- Steps:
--   1. HSET group metadata (name, state=ACTIVE, createdAt, updatedAt, totalJobs, completedCount=0, failedCount=0, cancelledCount=0, compensation)
--   2. ZADD groups index with score=timestamp, member=groupId
--   3. For each job key in ARGV[6..N], HSET group jobs hash: jobKey = "pending"
--   4. XADD event stream: group:created event

return ARGV[1]
