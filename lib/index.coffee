{Readable} = require 'stream'
{EventEmitter} = require 'events'
assert = require 'assert'
deepEquals = require 'deep-is'
redisLib = require 'redis'
arraydiff = require 'arraydiff'
ot = require './ot'

exports.client = (snapshotDb, redis = redisLib.createClient(), extraDbs = {}) ->
  # This is a set.
  streams = {}
  nextStreamId = 0

  redisObserver = redisLib.createClient redis.port, redis.host, redis.options
  redisObserver.auth redis.auth_pass if redis.auth_pass
  redisObserver.setMaxListeners 0

  subscribeCounts = {}

  # Redis has different databases, which are namespaced separately. We need to
  # make sure our pubsub messages are constrained to the database where we
  # published the op.
  prefixChannel = (channel) -> "#{redis.selected_db || 0} #{channel}"
  getOpLogKey = (cName, docName) -> "#{cName}.#{docName} ops"
  getDocOpChannel = (cName, docName) -> "#{cName}.#{docName}"

  redisSubmit = (cName, docName, opData, callback) ->
    logEntry = JSON.stringify {op:opData.op, src:opData.src, seq:opData.seq, create:opData.create, del:opData.del}
    # the opData object here contains deleted data for del operations. We don't use this... but fyi.
    docPubEntry = JSON.stringify opData # Publish everything to the document's channel

    #console.log opData.src, getOpLogKey(cName, docName), getDocOpChannel(cName, docName), # KEYS table
    #  opData.seq, opData.v, logEntry, docPubEntry, # ARGV table
    redis.eval """
-- ops here is a JSON string.
local clientNonceKey, opLogKey, docOpChannel = unpack(KEYS)
local seq, v, logEntry, docPubEntry = unpack(ARGV) -- From redisSubmit, below.
v = tonumber(v)
seq = tonumber(seq)

-- Check the version matches.
local realv = redis.call('LLEN', opLogKey)

if v < realv then
  --redis.log(redis.LOG_NOTICE, "k: " .. opLogKey .. " v: " .. v)
  return redis.call('LRANGE', opLogKey, v, -1)
elseif v > realv then
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
redis.call('RPUSH', opLogKey, logEntry)
redis.call('PUBLISH', docOpChannel, docPubEntry)

-- Finally, save the new nonce. We do this here so we only update the nonce if
-- we're at the most recent version in the oplog.
if seq ~= nil then
  --redis.log(redis.LOG_NOTICE, "set " .. clientNonceKey .. " to " .. seq)
  redis.call('SET', clientNonceKey, seq)
  redis.call('EXPIRE', clientNonceKey, 60*60*24*7) -- 1 week
end
    """, 3, # num keys
      opData.src, (getOpLogKey cName, docName), (prefixChannel getDocOpChannel cName, docName), # KEYS table
      opData.seq, opData.v, logEntry, docPubEntry, # ARGV table
      callback

  client =
    ###
    create: (cName, docName, type, initialData, meta, callback) ->
      # Not matching all possible cases here. Eh.
      [initialData, callback] = [null, initialData] if typeof initialData is 'function'
      [meta, callback] = [{}, meta] if typeof meta is 'function'

      type = otTypes[type] if typeof type is 'string'
      return callback? new Error 'Type not found' unless type

      # + NOTIFY! Otherwise this won't work correctly with queries.

      snapshotDb.create cName, docName,
        type:type.url || type.name
        v:0
        data:type.create initialData
        meta:meta or {}
      , callback # Just passing the error straight through. Should probably sanitize it.
    ###

    snapshotDb: snapshotDb

    # Non inclusive - gets ops from [from, to). Ie, all relevant ops. If to is not defined
    # (null or undefined) then it returns all ops.
    getOps: (cName, docName, from, to, callback) ->
      [to, callback] = [-1, to] if typeof to is 'function'
      to ?= -1

      if to >= 0
        return callback? null, [] if from >= to
        to--

      return callback 'invalid getOps fetch' unless from?
      #console.trace 'getOps', getOpLogKey(cName, docName), from, to
      redis.lrange getOpLogKey(cName, docName), from, to, (err, values) ->
        return callback? err if err
        ops = for value in values
          op = JSON.parse value
          op.v = from++ # The version is stripped from the ops in the oplog. Add it back.
          op
        callback null, ops

    publish: (channel, data) ->
      redis.publish prefixChannel(channel), (if data then JSON.stringify data)

    submit: (cName, docName, opData, callback) ->
      validate = opData.validate or (opData, snapshot, callback) -> callback()
      preValidate = opData.preValidate or (opData, snapshot, callback) -> callback()

      #console.log 'submit opdata ', opData
      err = ot.checkOpData opData
      return callback? err if err

      ot.normalize opData

      transformedOps = []

      do retry = =>
        # Get doc snapshot. We don't need it for transform, but we will
        # try to apply the operation locally before saving it.
        @fetch cName, docName, (err, snapshot) =>
          opData.v = snapshot.v if !opData.v?

          return callback? err if err
          return callback? 'Invalid version' if snapshot.v < opData.v

          trySubmit = =>
            # Eagarly try to submit to redis. If this fails, redis will return all the ops we need to
            # transform by.
            redisSubmit cName, docName, opData, (err, result) =>
              return callback? err if err
              return callback? result if typeof result is 'string'

              if result and typeof result is 'object'
                # There are ops that should be applied before our new operation.
                oldOpData = (JSON.parse d for d in result)

                for old in oldOpData
                  old.v = opData.v
                  transformedOps.push old

                  err = ot.transform snapshot.type, opData, old
                  return callback? err if err

                  # If we want to remove the need to @fetch again when we retry, do something
                  # like this, but with the original snapshot object:
                  #err = ot.apply snapshot, old
                  #return callback? err if err

                #console.log 'retry'
                return retry()

              # Call callback with op submit version
              return callback? null, opData.v, transformedOps, snapshot if snapshotDb.closed # Happens in the tests sometimes. Its ok.

              # Update the snapshot for queries
              snapshotDb.setSnapshot cName, docName, snapshot, (err) =>
                return callback? err if err

                # And SOLR or whatever. Not entirely sure of the timing here.
                for name, db of extraDbs
                  db.submit? cName, docName, opData, snapshot, this, (err) ->
                    console.warn "Error updating db #{db.name} #{cName}.#{docName} with new snapshot data: ", err if err

                opData.docName = docName
                redis.publish prefixChannel(cName), JSON.stringify opData

                callback? null, opData.v, transformedOps, snapshot


          # If there's actually a chance of submitting, try applying the operation to make sure
          # its valid.
          if snapshot.v is opData.v
            preValidate opData, snapshot, (err) ->
              return callback? err if err

              err = ot.apply snapshot, opData
              return callback? err if err

              validate opData, snapshot, (err) ->
                return callback? err if err
                trySubmit()
          else
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

        @getOps cName, docName, snapshot.v, (err, opData) ->
          return callback? err if err
          err = ot.apply snapshot, d for d in opData
          callback err, snapshot

    fetchAndSubscribe: (cName, docName, callback) ->
      @fetch cName, docName, (err, data) =>
        return callback err if err
        @subscribe cName, docName, data.v, (err, stream) ->
          callback err, data, stream

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
    query: (index, query, opts, callback) ->
      [opts, callback] = [{}, opts] if typeof opts is 'function'

      if opts.backend
        return callback 'Backend not found' unless extraDbs.hasOwnProperty opts.backend
        db = extraDbs[opts.backend]
      else
        db = snapshotDb

      poll = if !db.queryDoc
        true
      else if opts.poll is undefined and db.queryNeedsPollMode
        db.queryNeedsPollMode query
      else
        opts.poll

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

            # Not sure whether the changed document should be in the result set
            if modifies is undefined
              if poll
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
                    unless a and b
                      console.log '####### undefined stuffs'
                      console.log results
                      console.log newResults
                    return false unless a and b
                    a.docName is b.docName and a.c is b.c
                  if diff.length
                    emitter.data = results = newResults
                    d.type = d.type for d in diff
                    emitter.emit 'diff', diff

                  #docIdx["#{d.c}.#{d.docName}"] = i for d, i in results
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
      submit: (docName, opData, callback) -> client.submit cName, docName, opData, callback
      subscribe: (docName, v, callback) -> client.subscribe cName, docName, v, callback

      getOps: (docName, from, to, callback) -> client.getOps cName, docName, from, to, callback

      fetch: (docName, callback) -> client.fetch cName, docName, callback
      fetchAndObserve: (docName, callback) -> client.fetchAndObserve cName, docName, callback

      queryFetch: (query, opts, callback) -> client.queryFetch cName, query, opts, callback
      query: (query, opts, callback) -> client.query cName, query, opts, callback

    destroy: ->
      #snapshotDb.close()
      redis.quit()

      # ... and close any remaining subscription streams.
      for id, s of streams
        s.destroy()

