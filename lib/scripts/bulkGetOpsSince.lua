-- We'll preserve order in the results.
local results = {}

for i=1,#KEYS,2 do
  local versionKey = KEYS[i]
  local opLogKey = KEYS[i+1]
  local from = tonumber(ARGV[(i+1)/2])

  local v = tonumber(redis.call('get', versionKey))

  if v == nil then
    -- We're asking for ops that redis doesn't have. Have to get them from the oplog.
    results[#results+1] = 0 -- A nil in a lua table doesn't have the semantics I need.
  elseif from >= v then
    -- Most common case. There's no ops, get over it & move on with your life.
    results[#results+1] = {}
  else
    local numExpected = v - from
    from = from - v
    local ops = redis.call('lrange', opLogKey, from, -1)
    if #ops ~= numExpected then
      results[#results+1] = 0 -- Punt back to the oplog for the ops themselves.
    else
      results[#results+1] = ops
    end
  end
end

return results
