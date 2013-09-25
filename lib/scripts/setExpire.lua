local versionKey, opLogKey = unpack(KEYS)
local v = unpack(ARGV)

v = tonumber(v)

-- Check the version matches.
local realv = tonumber(redis.call('get', versionKey))

if v == realv - 1 then
  redis.call('expire', versionKey, 60*60*24) -- 1 day
  redis.call('expire', opLogKey, 60*60*24) -- 1 day
  redis.call('ltrim', opLogKey, -100, -1) -- Only 100 ops, counted from the end.

  --redis.call('del', versionKey)
  --redis.call('del', opLogKey)
  --redis.call('del', opLogKey)

  -- Doing this directly for now. I don't know the performance impact, but its cleaner.
  --redis.call('PUBLISH', publishChannel, opData)
end
