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
    8. Emit events on both queues.
    9. Return the new job ID.

    Input:
      KEYS[1]  dlqJobHash         - DLQ job hash key       (bull:{dlq}:{dlqJobId})
      KEYS[2]  dlqWait            - DLQ waiting list        (bull:{dlq}:wait)
      KEYS[3]  sourceWait         - source queue wait list  (bull:{sourceQueue}:wait)
      KEYS[4]  sourceJobHash      - source job hash key     (bull:{sourceQueue}:{newJobId})

      ARGV[1]  dlqJobId           - DLQ job ID to replay
      ARGV[2]  newJobId           - pre-generated UUID for the replayed job in source queue
      ARGV[3]  timestamp          - current timestamp (ms)
      ARGV[4]  sourceQueuePrefix  - key prefix for the source queue

    Output:
      newJobId string on success
      -1 if the DLQ job hash does not exist
]]

-- TODO(features): implement full atomic logic

return ARGV[2]
