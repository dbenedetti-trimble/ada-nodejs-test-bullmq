--[[
  Enqueue compensation jobs atomically into compensation queues.

  Input:
    KEYS[1] compensation queue wait key
    KEYS[2] compensation queue meta key
    KEYS[3] compensation queue events stream key

    ARGV[1] JSON array of compensation job definitions

  Output:
    number - count of compensation jobs created
]]
-- TODO: implement in features pass
return 0
