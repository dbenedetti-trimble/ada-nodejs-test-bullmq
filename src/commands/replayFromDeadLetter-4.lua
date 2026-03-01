--[[
  Atomically replay a DLQ job back to its original source queue.
  Reads DLQ job hash, strips _dlqMeta from data, creates a new job in the source queue,
  removes the DLQ job, and emits events on both queues.

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
      source events stream: 'waiting' { jobId }
      DLQ events stream:    'removed' { jobId }
]]
local rcall = redis.call

-- TODO: implement business logic in features pass
-- Stub: return placeholder
return ARGV[2]
