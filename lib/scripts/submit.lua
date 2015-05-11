local versionKey, opLogKey = unpack(KEYS)
-- The regular keys are followed by the dirty list names
local DIRTY_KEYS_IDX = 3

local v, logEntry, docVersion = unpack(ARGV) -- From redisSubmit, below.
-- ... and the regular args are followed by the dirty list data.
local DIRTY_ARGS_IDX = 4

v = tonumber(v)
docVersion = tonumber(docVersion)

-- Check the version matches.
if docVersion ~= nil then
  -- setnx returns true if we set the value.
  if redis.call('setnx', versionKey, docVersion) == 0 then
    docVersion = tonumber(redis.call('get', versionKey))
  else
    -- We've just set the version ourselves. Wipe any junk in the oplog.
    redis.call('del', opLogKey)
  end
else
  docVersion = tonumber(redis.call('get', versionKey))
end

if docVersion == nil then
  -- This is not an error - it will happen whenever the TTL expires or redis is wiped.
  return "Missing data"
end


if v < docVersion then
  -- The operation needs transformation. I could short-circuit here for
  -- performance and return any ops in redis, but livedb logic is simpler if I
  -- simply punt to getOps() below, and I don't think its a bottleneck.
  return "Transform needed"
  --local ops = redis.call('lrange', opLogKey, -(docVersion - v), -1)
  --ops[#ops + 1] = docVersion
  --return ops
elseif v > docVersion then
  -- Redis's version is older than the snapshot database. We might just be out
  -- of date, though it should be mostly impossible to get into this state.
  -- We'll dump all our data and expect to be refilled from whatever is in the
  -- persistant oplog.
  redis.call('del', versionKey)
  return "Version from the future"
end

-- Ok to submit. Save the op in the oplog and publish.
redis.call('rpush', opLogKey, logEntry)
redis.call('set', versionKey, v + 1)

redis.call('persist', opLogKey)
redis.call('persist', versionKey)

for i=DIRTY_KEYS_IDX,#KEYS do
  local data = ARGV[i - DIRTY_KEYS_IDX + DIRTY_ARGS_IDX]
  local dirtyKey = KEYS[i]
  redis.call('rpush', dirtyKey, data)
  -- It doesn't matter what data we publish here, it just needs to kick the
  -- client.
  redis.call('publish', dirtyKey, 1)
end
