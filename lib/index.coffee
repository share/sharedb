{Readable} = require 'stream'
{EventEmitter} = require 'events'
assert = require 'assert'
{isError} = require 'util'
deepEquals = require 'deep-is'
redisLib = require 'redis'
arraydiff = require 'arraydiff'
ot = require './ot'
rateLimit = require './ratelimit'

# I'm not really sure how the memory store should be exported...
exports.memory = require './memory'

# The client is created using either an options object or a database backend
# which is used as both oplog and snapshot.
#
# Eg:
#  db = require('livedb-mongo')('localhost:27017/test?auto_reconnect', {safe:true});
#  livedb = require('livedb').client(db);
#
# Or using an options object:
#
#  db = require('livedb-mongo')('localhost:27017/test?auto_reconnect', {safe:true});
#  livedb = require('livedb').client({db:db});
#
# If you want, you can use a different database for both snapshots and operations:
#
#  snapshotdb = require('livedb-mongo')('localhost:27017/test?auto_reconnect', {safe:true});
#  oplog = {writeOp:..., getVersion:..., getOps:...}
#  livedb = require('livedb').client({snapshotDb:snapshotdb, oplog:oplog});
#
# Other options:
#
# - redis:<redis client>. This can be specified if there is any further
#     configuration of redis that you want to perform. The obvious examples of
#     this are when redis is running on a remote machine, redis requires
#     authentication or you want to use something other than redis db 0.
#
# - redisObserver:<redis client>. Livedb actually needs 2 redis connections,
#     because redis doesn't let you use a connection with pubsub subscriptions
#     to edit data. Livedb will automatically try to clone the first connection
#     to make the observer connection, but we can't copy some options, like the
#     selected database. if you want to change that (or do anything else thats
#     fancy), you should make 2 redis instances and provide livedb with both of
#     them.
#
# - extraDbs:{}  This is used to register extra database backends which will be
#     notified whenever operations are submitted. They can also be used in
#     queries.
#
exports.client = (options) ->
  # Database which stores the documents.
  snapshotDb = options.snapshotDb or options.db or options
  throw new Error 'Missing or invalid snapshot db' unless snapshotDb.getSnapshot && snapshotDb.writeSnapshot

  # Database which stores the operations.
  oplog = options.oplog or options.db or options
  throw new Error 'Missing or invalid operation log' unless oplog.writeOp && oplog.getVersion && oplog.getOps

  # Redis is used for submitting canonical operations and pubsub.
  redis = options.redis or redisLib.createClient()

  # Redis doesn't allow the same connection to both listen to channels and do
  # operations. We make an extra redis connection for the streams.
  redisObserver = options.redisObserver
  unless redisObserver
    redisObserver = redisLib.createClient redis.port, redis.host, redis.options
    redisObserver.auth redis.auth_pass if redis.auth_pass
  redisObserver.setMaxListeners 0

  # This contains any extra databases that can be queried & notified when documents change
  extraDbs = options.extraDbs or {}


  # This is a set of all the outstanding streams that have been subscribed by clients
  streams = {}
  nextStreamId = 0

  # Map from channel name -> number of subscribers. Used for garbage collection
  # - when the count reaches 0, the listener is abandoned.
  subscribeCounts = {}

  # Redis has different databases, which are namespaced separately. We need to
  # make sure our pubsub messages are constrained to the database where we
  # published the op.
  prefixChannel = (channel) -> "#{redis.selected_db || 0} #{channel}"
  getVersionKey = (cName, docName) -> "#{cName}.#{docName} v"
  getOpLogKey = (cName, docName) -> "#{cName}.#{docName} ops"
  getDocOpChannel = (cName, docName) -> "#{cName}.#{docName}"

  processRedisOps = (to, result) ->
    #console.log 'processRedisOps', to, result
    # The ops are stored in redis as JSON strings without versions. They're
    # returned with the final version at the end of the lua table.

    # version of the document
    docV = result.pop()
    v = if to is -1
      docV - result.length
    else
      to - result.length + 1 # the 'to' argument here is the version of the last op.

    for value in result
      op = JSON.parse value
      op.v = v++
      op

  logEntryForData = (opData) ->
    # Only put the op itself and the op's id in redis's log. The version can be inferred via the version field.
    entry = {}
    entry.src = opData.src if opData.src
    entry.seq = opData.seq if opData.seq
    if opData.op
      entry.op = opData.op
    else if opData.del
      entry.del = opData.del
    else if opData.create
      entry.create = opData.create
    entry

  # docVersion is optional - if specified, this is set & used if redis doesn't know the doc's version
  redisSubmitScript = (cName, docName, opData, docVersion, callback) ->
    logEntry = JSON.stringify logEntryForData opData
    docPubEntry = JSON.stringify opData # Publish everything in opdata to the document's channel.

    redis.eval """
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
    """, 4, # num keys
      opData.src, getVersionKey(cName, docName), getOpLogKey(cName, docName), prefixChannel(getDocOpChannel cName, docName), # KEYS table
      opData.seq, opData.v, logEntry, docPubEntry, docVersion, # ARGV table
      (err, result) ->
        return callback err if err
        #result = processRedisOps -1, result if Array.isArray result
        callback err, result

  atomicSubmit = (cName, docName, opData, callback) ->
    redisSubmitScript cName, docName, opData, null, (err, result) ->
      return callback err if err

      if result is 'Missing data' or result is 'Version from the future'
        # The data in redis has been dumped. Fill redis with data from the oplog and retry.
        oplog.getVersion cName, docName, (err, version) ->
          return callback err if err

          console.warn "Repopulating redis for #{cName}.#{docName} #{opData.v}#{version}", result if version > 0

          if version < opData.v
            # This is nate's awful hell error state. The oplog is basically
            # corrupted - the snapshot database is further in the future than
            # the oplog.
            #
            # In this case, we should write a no-op ramp to the snapshot
            # version, followed by a delete & a create to fill in the missing
            # ops.
            throw new Error "Missing oplog for #{cName} #{docName}"

          redisSubmitScript cName, docName, opData, version, callback

      else
        # The result here will contain more errors (for example we might still be at an early version).
        # Thats totally ok.
        callback null, result

  # Follows same semantics as getOps elsewhere - returns ops [from, to). May
  # not return all operations in this range.
  redisGetOps = (cName, docName, from, to, callback) ->
    to ?= -1

    if to >= 0
      return callback null, [] if from >= to or to == 0
      to--

    #console.log 'redisGetOps', from, to

    redis.eval """
local versionKey, opLogKey = unpack(KEYS)
local from = tonumber(ARGV[1])
local to = tonumber(ARGV[2])

local v = tonumber(redis.call('get', versionKey))

-- We're asking for ops the server doesn't have.
if v == nil or from >= v then return nil end

--redis.log(redis.LOG_NOTICE, "v " .. tostring(v) .. " from " .. from .. " to " .. to)
if to >= 0 then
  to = to - v
end
from = from - v

local ops = redis.call('lrange', opLogKey, from, to)
ops[#ops+1] = v -- We'll put the version of the document at the end.
return ops
    """, 2, getVersionKey(cName, docName), getOpLogKey(cName, docName), from, to, (err, result) ->
      return callback err if err
      return callback null, [] if result is null # No data in redis. Punt to the persistant oplog.
      ops = processRedisOps to, result
      callback null, ops

  # After we submit an operation, reset redis's TTL so the data is allowed to expire.
  redisSetExpire = (cName, docName, v, callback) ->
    redis.eval """
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
                  """, 2, getVersionKey(cName, docName), getOpLogKey(cName, docName), v, callback



  # Wrapper around the oplog to insert versions.
  oplogGetOps = (cName, docName, from, to, callback) ->
    oplog.getOps cName, docName, from, to, (err, ops) ->
      return callback err if err
      throw new Error 'Oplog is returning incorrect ops' if ops.length && ops[0].v isnt from
      op.v = from++ for op in ops
      callback null, ops

  # Non inclusive - gets ops from [from, to). Ie, all relevant ops. If to is
  # not defined (null or undefined) then it returns all ops. Due to certain
  # race conditions, its possible that this misses operations at the end of the
  # range. Callers have to deal with this case (semantically it should be the
  # same as an operation being submitted right after a getOps call)
  getOps = (cName, docName, from, to, callback) ->
    #console.log 'getOps', from, to

    # First try to get the ops from redis.
    redisGetOps cName, docName, from, to, (err, ops) ->
      return callback err if err

      if ops.length
        # What should we do in this case, when redis returns ops but is missing ops at the end of the requested range?
        #if to? && ops[ops.length - 1].v != to

        # We have at least some of the ops at the end of the range.
        if ops[0].v is from
          # Yay!
          return callback null, ops
        else
          # The ops we got from redis are at the end of the op list.
          oplogGetOps cName, docName, from, ops[0].v, (err, firstOps) ->
            return callback err if err
            callback null, firstOps.concat ops
      else
        # No ops in redis. Just get all the ops from the oplog.
        oplogGetOps cName, docName, from, to, callback

  # Internal method for updating the persistant oplog. This should only be called after atomicSubmit (above).
  writeOpToLog = (cName, docName, opData, callback) ->
    # Shallow copy the important fields from opData
    entry = logEntryForData opData
    entry.v = opData.v # The oplog API needs the version too.

    oplog.getVersion cName, docName, (err, version) ->
      return callback err if err

      if version < opData.v
        console.log 'populating oplog', version, opData.v
        redisGetOps cName, docName, version, opData.v, (err, results) ->
          return callback err if err

          results.push entry

          do f = ->
            return callback() if results.length is 0

            oplog.writeOp cName, docName, results.shift(), (err) ->
              return callback err if err
              # In a nexttick to prevent stack overflows with syncronous oplog
              # implementations
              process.nextTick f

      else if version == opData.v
        oplog.writeOp cName, docName, entry, (err) =>
          callback err

  client =
    snapshotDb: snapshotDb
    oplog: oplog

    # Non inclusive - gets ops from [from, to). Ie, all relevant ops. If to is not defined
    # (null or undefined) then it returns all ops.
    getOps: (cName, docName, from, to, callback) ->
      [to, callback] = [null, to] if typeof to is 'function'
      if to >= 0
        return callback null, [] if to? && from > to

      return callback 'Invalid from field in getOps' unless from?
      #console.trace 'getOps', getOpLogKey(cName, docName), from, to
      getOps cName, docName, from, to, callback

    publish: (channel, data) ->
      redis.publish prefixChannel(channel), (if data then JSON.stringify data)

    submit: (cName, docName, opData, options, callback) ->
      #console.log 'submit', opData
      # This changed recently. We'll support the old API for now.
      [options, callback] = [{}, options] if typeof options is 'function'
      options ?= {}

      #options.channelPrefix
      #console.log 'submit opdata ', opData
      err = ot.checkOpData opData
      return callback? err if err

      ot.normalize opData

      transformedOps = []

      do retry = =>
        # Get doc snapshot. We don't need it for transform, but we will
        # try to apply the operation locally before saving it.
        @fetch cName, docName, (err, snapshot) =>
          return callback? err if err
          return callback? 'Invalid version' if snapshot.v < opData.v
          opData.v = snapshot.v if !opData.v?

          trySubmit = =>
            # Eagarly try to submit to redis. If this fails, redis will return all the ops we need to
            # transform by.
            atomicSubmit cName, docName, opData, (err, result) =>
              return callback? err if err

              if result is 'Transform needed'
                return getOps cName, docName, opData.v, null, (err, ops) ->
                  return callback? err if err
                  return callback? 'Intermediate operations missing - cannot apply op' if ops.length is 0

                  # There are ops that should be applied before our new operation.
                  for old in ops
                    transformedOps.push old

                    err = ot.transform snapshot.type, opData, old
                    return callback? err if err

                    # If we want to remove the need to @fetch again when we retry, do something
                    # like this, but with the original snapshot object:
                    #err = ot.apply snapshot, old
                    #return callback? err if err

                  #console.log 'retry'
                  return retry()

              return callback? result if typeof result is 'string'
              # Call callback with op submit version
              #return callback? null, opData.v, transformedOps, snapshot if snapshotDb.closed # Happens in the tests sometimes. Its ok.

              writeOpToLog cName, docName, opData, (err) =>
                # Its kinda too late for this to error out - we've committed.
                return callback? err if err

                # Update the snapshot for queries
                snapshotDb.writeSnapshot cName, docName, snapshot, (err) =>
                  return callback? err if err

                  # And SOLR or whatever. Not entirely sure of the timing here.
                  for name, db of extraDbs
                    db.submit? cName, docName, opData, options, snapshot, this, (err) ->
                      console.warn "Error updating db #{name} #{cName}.#{docName} with new snapshot data: ", err if err

                  opData.docName = docName
                  # Publish the change to the collection for queries and set
                  # the TTL on the document now that it has been written to the
                  # oplog.
                  redis.publish prefixChannel(cName), JSON.stringify opData
                  redisSetExpire cName, docName, opData.v, (err) ->
                    console.error err if err # This shouldn't happen, but its non-fatal. It just means ops won't get flushed from redis.

                  callback? null, opData.v, transformedOps, snapshot



          # If there's actually a chance of submitting, try applying the operation to make sure
          # its valid.
          if snapshot.v is opData.v
            err = ot.apply snapshot, opData
            if err
              if typeof err isnt 'string' and !isError err
                console.warn 'INVALID VALIDATION FN!!!!'
                console.warn 'Your validation function must return null/undefined, a string or an error object.'
                console.warn 'Instead we got', err
              return callback? err

          trySubmit()

    # Subscribe to a redis pubsub channel and get a nodejs stream out
    _subscribeChannels: (channels, callback) ->
      # TODO: 2 refactors:
      #        - Make the redis observer we use here reusable
      #        - Reuse listens on channels
      stream = new Readable objectMode:yes

      # This function is for notifying us that the stream is empty and needs data.
      # For now, we'll just ignore the signal and assume the reader reads as fast
      # as we fill it. I could add a buffer in this function, but really I don't think
      # that is any better than the buffer implementation in nodejs streams themselves.
      stream._read = ->

      open = true

      stream._id = nextStreamId++
      streams[stream._id] = stream

      stream.destroy = ->
        return unless open

        stream.push null
        open = false
        delete streams[stream._id]
        if Array.isArray channels
          for channel, i in channels
            continue if --subscribeCounts[channel] > 0
            redisObserver.unsubscribe channel
            delete subscribeCounts[channel]
        else
          unless --subscribeCounts[channels] > 0
            redisObserver.unsubscribe channels
            delete subscribeCounts[channels]
        redisObserver.removeListener 'message', onMessage

        stream.emit 'close'
        stream.emit 'end'

      if Array.isArray channels
        for channel, i in channels
          channel = channels[i] = prefixChannel channel
          subscribeCounts[channel] = (subscribeCounts[channel] || 0) + 1
        onMessage = (msgChannel, msg) ->
          # We shouldn't get messages after unsubscribe, but it's happened.
          return if !open || channels.indexOf(msgChannel) == -1

          data = JSON.parse msg
          # Unprefix database name from the channel
          data.channel = msgChannel.slice msgChannel.indexOf(' ') + 1
          stream.push data
        channelList = channels
      else
        channels = prefixChannel channels
        subscribeCounts[channels] = (subscribeCounts[channels] || 0) + 1
        onMessage = (msgChannel, msg) ->
          # We shouldn't get messages after unsubscribe, but it's happened.
          return if !open || msgChannel isnt channels
          data = JSON.parse msg
          stream.push data
        channelList = [channels]

      redisObserver.on 'message', onMessage

      redisObserver.subscribe channelList..., (err) ->
        if err
          stream.destroy()
          return callback err
        callback null, stream

    # Callback called with (err, op stream). v must be in the past or present. Behaviour
    # with a future v is undefined (because I don't think thats an interesting case).
    subscribe: (cName, docName, v, callback) ->
      opChannel = getDocOpChannel cName, docName

      # Subscribe redis to the stream first so we don't miss out on any operations
      # while we're getting the history
      @_subscribeChannels opChannel, (err, stream) =>
        callback err if err

        # From here on, we need to call stream.destroy() if there are errors.
        @getOps cName, docName, v, (err, data) ->
          if err
            stream.destroy()
            return callback err

          # Ok, so if there's anything in the stream right now, it might overlap with the
          # historical operations. We'll pump the reader and (probably!) prefix it with the
          # getOps result.
          queue = (d while d = stream.read())

          callback null, stream

          # First send all the operations between v and when we called getOps
          for d in data
            assert d.v is v
            v++
            stream.push d
          # Then all the ops between then and now..
          for d in queue when d.v >= v
            assert d.v is v
            v++
            stream.push d

    # Callback called with (err, {v, data})
    fetch: (cName, docName, callback) ->
      snapshotDb.getSnapshot cName, docName, (err, snapshot) =>
        return callback? err if err
        snapshot ?= {v:0}
        return callback 'Invalid snapshot data' unless snapshot.v?

        @getOps cName, docName, snapshot.v, (err, results) ->
          return callback? err if err
          err = ot.apply snapshot, opData for opData in results
          callback err, snapshot

    bulkFetchCached: (cName, docNames, callback) ->
      if snapshotDb.getBulkSnapshots
        snapshotDb.getBulkSnapshots cName, docNames, (err, results) ->
          return callback err if err

          # Results is unsorted and contains any documents that exist in the
          # snapshot database.
          map = {} # Map from docName -> data
          map[r.docName] = r for r in results

          list = (map[docName] or {v:0} for docName in docNames)
          callback null, list
      else
        # Call fetch on all the documents.
        results = new Array docNames.length
        pending = docNames.length + 1
        abort = false
        for docName, i in docNames
          do (i) =>
            @fetch cName, docName, (err, data) ->
              return if abort
              if err
                abort = true
                return callback err

              results[i] = data
              pending--
              callback results if pending is 0

        pending--
        callback results if pending is 0

    fetchAndSubscribe: (cName, docName, callback) ->
      @fetch cName, docName, (err, data) =>
        return callback err if err
        @subscribe cName, docName, data.v, (err, stream) ->
          callback err, data, stream




    # ------ Queries


    queryFetch: (cName, query, opts, callback) ->
      [opts, callback] = [{}, opts] if typeof opts is 'function'
      if opts.backend
        return callback 'Backend not found' unless extraDbs.hasOwnProperty opts.backend
        db = extraDbs[opts.backend]
      else
        db = snapshotDb

      db.query this, cName, query, (err, resultset) =>
        if err
          callback err
        else if Array.isArray resultset
          callback null, resultset
        else
          callback null, resultset.results, resultset.extra

    # For mongo, the index is just the collection itself. For something like
    # SOLR, the index refers to the core we're actually querying.
    #
    # Options can contain:
    # backend: the backend to use, or the name of the backend (if the backend
    #  is specified in the otherDbs when the livedb instance is created)
    # poll: true, false or undefined. Set true/false to force enable/disable
    #  polling mode. Undefined will let the database decide.
    # shouldPoll: function(collection, docName, opData, index, query) {return true or false; }
    #  this is a syncronous function which can be used as an early filter for
    #  operations going through the system to reduce the load on the backend. 
    # pollDelay: Minimum delay between subsequent database polls. This is used
    #  to batch updates to reduce load on the database at the expense of
    #  liveness.
    query: (index, query, opts, callback) ->
      [opts, callback] = [{}, opts] if typeof opts is 'function'

      if opts.backend
        return callback 'Backend not found' unless extraDbs.hasOwnProperty opts.backend
        db = extraDbs[opts.backend]
      else if snapshotDb.query
        db = snapshotDb
      else
        return callback 'Backend not specified and database does not support queries'

      poll = if !db.queryDoc
        true
      else if opts.poll is undefined and db.queryNeedsPollMode
        db.queryNeedsPollMode index, query
      else
        opts.poll

      # Default to 2 seconds
      delay = if typeof opts.pollDelay is 'number' then opts.pollDelay else 2000

      # console.log 'poll mode:', !!poll

      channels = if db.subscribedChannels
        db.subscribedChannels index, query, opts
      else
        [index]

      # subscribe to collection firehose -> cache. The firehose isn't updated until after the db,
      # so if we get notified about an op here, the document's been saved.
      @_subscribeChannels channels, (err, stream) =>
        return callback err if err

        # Issue query on db to get our initial result set.
        # console.log 'snapshotdb query', cName, query
        db.query this, index, query, (err, resultset) =>
          #console.log '-> pshotdb query', cName, query, resultset
          if err
            stream.destroy()
            return callback err

          emitter = new EventEmitter
          emitter.destroy = ->
            stream.destroy()

          if !Array.isArray resultset
            # Resultset is an object. It should look like {results:[..], data:....}
            emitter.extra = extra = resultset.extra
            results = resultset.results
          else
            results = resultset

          emitter.data = results

          # Maintain a map from docName -> index for constant time tests
          docIdx = {}
          for d, i in results
            d.c ||= index
            docIdx["#{d.c}.#{d.docName}"] = i

          if poll then runQuery = rateLimit delay, ->
            # We need to do a full poll of the query, because the query uses limits or something.
            db.query client, index, query, (err, newResultset) ->
              return emitter.emit 'error', new Error err if err

              if !Array.isArray newResultset
                if newResultset.extra
                  unless deepEquals extra, newResultset.extra
                    emitter.emit 'extra', newResultset.extra
                    emitter.extra = extra = newResultset.extra
                newResults = newResultset.results
              else
                newResults = newResultset

              r.c ||= index for r in newResults

              diff = arraydiff results, newResults, (a, b) ->
                return false unless a and b
                a.docName is b.docName and a.c is b.c
              if diff.length
                emitter.data = results = newResults
                data.type = data.type for data in diff
                emitter.emit 'diff', diff

          do f = -> while d = stream.read() then do (d) ->
            # Collection name.
            d.c = d.channel

            # We have some data from the channel stream about an updated document.
            #console.log d.docName, docIdx, results
            cachedData = results[docIdx["#{d.c}.#{d.docName}"]]

            # Ignore ops that are older than our data. This is possible because we subscribe before
            # issuing the query.
            return if cachedData and cachedData.v > d.v

            # Hook here to do syncronous tests for query membership. This will become an important
            # way to speed this code up.
            modifies = undefined #snapshotDb.willOpMakeDocMatchQuery cachedData?, query, d.op

            return if opts.shouldPoll and !opts.shouldPoll d.c, d.docName, d, index, query

            # Not sure whether the changed document should be in the result set
            if modifies is undefined
              if poll
                runQuery()
              else
                db.queryDoc client, index, d.c, d.docName, query, (err, result) ->
                  return emitter.emit 'error', new Error err if err
                  #console.log 'result', result, 'cachedData', cachedData

                  if result and !cachedData
                    # Add doc to the collection. Order isn't important, so
                    # we'll just whack it at the end.
                    result.c = d.c
                    results.push result
                    emitter.emit 'diff', [{type:'insert', index:results.length - 1, values:[result]}]
                    #emitter.emit 'add', result, results.length - 1
                    docIdx["#{result.c}.#{result.docName}"] = results.length - 1
                  else if !result and cachedData
                    # Remove doc from collection
                    name = "#{d.c}.#{d.docName}"
                    idx = docIdx[name]
                    delete docIdx[name]
                    #emitter.emit 'remove', results[idx], idx
                    emitter.emit 'diff', [{type:'remove', index:idx, howMany:1}]
                    results.splice idx, 1
                    while idx < results.length
                      r = results[idx++]
                      name = "#{r.c}.#{r.docName}"
                      docIdx[name]--

            #if modifies is true and !cachedData?
            # Add document. Not sure how to han


          # for each op in cache + firehose when op not older than query result
          #   check if op modifies collection.
          #     if yes or no: broadcast
          #     if unknown: issue mongo query with {_id:X}

            #console.log data

          stream.on 'readable', f

          callback null, emitter

    collection: (cName) ->
      submit: (docName, opData, options, callback) -> client.submit cName, docName, opData, options, callback
      subscribe: (docName, v, callback) -> client.subscribe cName, docName, v, callback

      getOps: (docName, from, to, callback) -> client.getOps cName, docName, from, to, callback

      fetch: (docName, callback) -> client.fetch cName, docName, callback
      fetchAndObserve: (docName, callback) -> client.fetchAndObserve cName, docName, callback

      queryFetch: (query, opts, callback) -> client.queryFetch cName, query, opts, callback
      query: (query, opts, callback) -> client.query cName, query, opts, callback

    destroy: ->
      #snapshotDb.close()
      redis.quit()
      redisObserver.quit()

      # ... and close any remaining subscription streams.
      for id, s of streams
        s.destroy()

