local clientNonceKey, versionKey, opLogKey, docOpChannel = unpack(KEYS)
local seq, v, logEntry, docPubEntry, docVersion = unpack(ARGV) -- From redisSubmit, below.
v = tonumber(v)
seq = tonumber(seq)
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

-- Dedup, but only if the id has been set.
if seq ~= nil then
  local nonce = redis.call('GET', clientNonceKey)
  if nonce ~= false and tonumber(nonce) >= seq then
    return "Op already submitted"
  end
end

-- Ok to submit. Save the op in the oplog and publish.
redis.call('rpush', opLogKey, logEntry)
redis.call('set', versionKey, v + 1)

redis.call('persist', opLogKey)
redis.call('persist', versionKey)

redis.call('publish', docOpChannel, docPubEntry)

-- Finally, save the new nonce. We do this here so we only update the nonce if
-- we're at the most recent version in the oplog.
if seq ~= nil then
  --redis.log(redis.LOG_NOTICE, "set " .. clientNonceKey .. " to " .. seq)
  redis.call('SET', clientNonceKey, seq)
  redis.call('EXPIRE', clientNonceKey, 60*60*24*7) -- 1 week
end
