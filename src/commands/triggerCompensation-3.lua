--[[
  Enqueues compensation jobs atomically into a compensation queue's wait list.

  Input:
    KEYS[1] compensation queue wait list key  ({prefix}:{compQueueName}:wait)
    KEYS[2] compensation queue meta key       ({prefix}:{compQueueName}:meta)
    KEYS[3] compensation events stream key    ({prefix}:{compQueueName}:events)

    ARGV[1] msgpacked arguments:
      array of compensation job entries, each:
        [jobName, jobData (JSON), jobOpts (msgpacked), groupId, originalJobName,
         originalJobId, originalReturnValue (JSON)]

  Output:
    number of compensation jobs enqueued
]]

-- TODO(features): implement compensation job insertion using addStandardJob pattern
-- Stub returns 0 for scaffold.

local rcall = redis.call

return 0
