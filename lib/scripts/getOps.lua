local versionKey, opLogKey = unpack(KEYS)
local from = tonumber(ARGV[1])
local to = tonumber(ARGV[2])

local v = tonumber(redis.call('get', versionKey))

-- We're asking for ops the server doesn't have.
if v == nil then return nil end
if from >= v then return {v} end

--redis.log(redis.LOG_NOTICE, "v " .. tostring(v) .. " from " .. from .. " to " .. to)
if to >= 0 then
  to = to - v
end
from = from - v

local ops = redis.call('lrange', opLogKey, from, to)
ops[#ops+1] = v -- We'll put the version of the document at the end.
return ops
