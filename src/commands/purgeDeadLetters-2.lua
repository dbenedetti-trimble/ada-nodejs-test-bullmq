--[[
  Bulk-removes jobs from a dead letter queue's waiting list, with optional filtering.

  Steps:
    1. LRANGE the DLQ waiting list to get all job IDs.
    2. For each job ID:
         a. HGETALL the job hash.
         b. If filterName is non-empty, skip jobs whose name does not match.
         c. If filterReason is non-empty, skip jobs whose _dlqMeta.failedReason
            does not contain filterReason (case-insensitive).
         d. If the job matches: DEL hash, LREM from waiting list, increment count.
    3. Return the count of removed jobs.

    Input:
      KEYS[1]  dlqWait            - DLQ waiting list key   (bull:{dlq}:wait)
      KEYS[2]  dlqJobHashPrefix   - key prefix for DLQ job hashes (bull:{dlq}:)

      ARGV[1]  filterName         - exact job name to match, or empty string for all
      ARGV[2]  filterReason       - failedReason substring, or empty string for all

    Output:
      integer count of jobs removed
]]

-- TODO(features): implement full filtering and removal logic

return 0
