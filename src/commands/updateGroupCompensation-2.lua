--[[
  Tracks completion of a compensation job and transitions group to terminal state
  when all compensations are done.

  Input:
    KEYS[1] group hash key    ({prefix}:{queueName}:groups:{groupId})
    KEYS[2] events stream key ({prefix}:{queueName}:events)

    ARGV[1] msgpacked arguments:
      [1] groupId
      [2] finalStatus         ("completed" | "failed")
      [3] timestamp           (epoch ms)

  Output (plain array):
    [1] groupState: new group state string
    [2] allDone: 1 (true) or 0 (false)
]]

local rcall = redis.call

local args = cmsgpack.unpack(ARGV[1])
local groupId = args[1]
local finalStatus = args[2]
local timestamp = args[3]

local groupData = rcall("HMGET", KEYS[1], "state", "name", "compensationTotal", "compensationDone", "compensationFailed")
local state = groupData[1]
local groupName = groupData[2]
local compensationTotal = tonumber(groupData[3]) or 0
local compensationDone = tonumber(groupData[4]) or 0
local compensationFailed = tonumber(groupData[5]) or 0

if not state then
  return {"UNKNOWN", 0}
end

-- Only process in COMPENSATING state
if state ~= "COMPENSATING" then
  local isDone = (state == "FAILED" or state == "FAILED_COMPENSATION") and 1 or 0
  return {state, isDone}
end

-- Increment done count
compensationDone = compensationDone + 1
rcall("HINCRBY", KEYS[1], "compensationDone", 1)

if finalStatus == "failed" then
  compensationFailed = compensationFailed + 1
  rcall("HINCRBY", KEYS[1], "compensationFailed", 1)
end

rcall("HSET", KEYS[1], "updatedAt", timestamp)

local maxEvents = 10000

-- Check if all compensations are complete
if compensationTotal > 0 and compensationDone >= compensationTotal then
  local newState
  if compensationFailed > 0 then
    newState = "FAILED_COMPENSATION"
  else
    newState = "FAILED"
  end

  rcall("HSET", KEYS[1], "state", newState)
  rcall("XADD", KEYS[2], "MAXLEN", "~", maxEvents, "*",
    "event", "group:failed",
    "groupId", groupId,
    "groupName", groupName,
    "state", newState)

  return {newState, 1}
end

return {"COMPENSATING", 0}
