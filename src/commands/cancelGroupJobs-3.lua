--[[
  Cancels all pending/waiting/delayed member jobs within a group.

  Iterates the group jobs hash and removes pending jobs from their
  respective queue sets (wait list, delayed ZSET, prioritized ZSET).
  Updates per-job status to "cancelled" and increments cancelledCount.

  Input:
    KEYS[1] group hash key        ({prefix}:{queueName}:groups:{groupId})
    KEYS[2] group jobs hash key   ({prefix}:{queueName}:groups:{groupId}:jobs)
    KEYS[3] event stream key      ({prefix}:{queueName}:events)

    ARGV[1] timestamp (epoch ms)
    ARGV[2] group ID

  Output:
    Number of jobs cancelled
]]

-- TODO(features): implement pending job cancellation
-- Steps:
--   1. HGETALL group jobs hash to get all jobKey → status pairs
--   2. For each job with status "pending":
--        a. Parse jobKey to get prefix, queueName, jobId
--        b. Try LREM {prefix}:{queueName}:wait 0 {jobId}
--        c. Try ZREM {prefix}:{queueName}:delayed {jobId}
--        d. Try ZREM {prefix}:{queueName}:prioritized {jobId}
--        e. HSET group jobs hash: jobKey = "cancelled"
--        f. Increment cancelled counter
--   3. HINCRBY cancelledCount on group hash
--   4. HSET updatedAt on group hash
--   5. Return number cancelled

return 0
