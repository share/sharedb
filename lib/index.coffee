{Readable} = require 'stream'
{EventEmitter} = require 'events'
assert = require 'assert'
redisLib = require 'redis'
otTypes = require 'ot-types'

exports.mongo = require './mongo'

exports.client = (snapshotDb, redis) ->
  getOpLogKey = (cName, docName) -> "#{cName}.#{docName} ops"
  getDocOpChannel = (cName, docName) -> "#{cName}.#{docName}"

  # Non inclusive - gets ops from [from, to). Ie, all relevant ops. If to is not defined
  # (null or undefined) then it returns all ops.
  getOps = (cName, docName, from, to, callback) ->
    [to, callback] = [-1, to] if typeof to is 'function'
    to ?= -1

    if to >= 0
      return callback? null, [] if from >= to
      to--

    redis.lrange getOpLogKey(cName, docName), from, to, (err, values) ->
      return callback? err if err
      ops = for value in values
        op = JSON.parse value
        op.v = from++ # The version is stripped from the ops in the oplog. Add it back.
        op
      callback null, ops

  redisSubmit = (cName, docName, opData, callback) ->
    logEntry = JSON.stringify {op:opData.op, id:opData.id}
    docPubEntry = JSON.stringify opData # Publish everything to the document's channel
    if opData.id
      pair = opData.id.split '.'
      # I could say seq = parseInt pair[1], 10 ... but it'll be converted to a string by redis anyway.
      seq = pair[1]
      clientNonceKey = "c #{pair[0]}"

    redis.eval """
-- ops here is a JSON string.
local clientNonceKey, opLogKey, docOpChannel = unpack(KEYS)
local seq, v, logEntry, docPubEntry = unpack(ARGV) -- From redisSubmit, below.
v = tonumber(v)
seq = tonumber(seq)

-- Dedup, but only if the id has been set.
if seq ~= nil then
  
  local nonce = redis.call('GET', clientNonceKey)
  if nonce == false or tonumber(nonce) < seq then
    redis.call('SET', clientNonceKey, seq)
    redis.call('EXPIRE', clientNonceKey, 60*60*24*7) -- 1 week
  else
    return "Op already submitted"
  end
end

-- Check the version matches.
local realv = redis.call('LLEN', opLogKey)

if v < realv then
  return redis.call('LRANGE', opLogKey, v, -1)
elseif v > realv then
  return "Version from the future"
end

-- Ok to submit. Save the op in the oplog and publish.
redis.call('RPUSH', opLogKey, logEntry)
redis.call('PUBLISH', docOpChannel, docPubEntry)
    """, 3, # num keys
      clientNonceKey, getOpLogKey(cName, docName), getDocOpChannel(cName, docName), # KEYS table
      seq, opData.v, logEntry, docPubEntry, # ARGV table
      callback

  client =
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

    submit: (cName, docName, opData, callback) ->
      return callback new Error 'missing version' unless typeof opData.v is 'number'
      return callback new Error 'missing op' unless typeof (opData.op or opData.ops) is 'object'

      # Get doc snapshot. We don't need it for transform, but we will
      # try to apply the operation before saving it.
      @fetch cName, docName, (err, snapshot) ->
        return callback? err if err

        type = otTypes[snapshot.type]
        return callback? new Error "Type #{snapshot.type} missing" unless type
        
        # Just eagarly try to submit to redis. If this fails, redis will return all the ops we need to
        # 'transform' by.
        do retry = ->
          if snapshot.v is opData.v
            try
              doc = type.apply snapshot.data, opData.op
            catch e
              console.log e.stack
              return callback? e.message

          # Send op to redis script (and retry if needed)
          redisSubmit cName, docName, opData, (err, result) ->
            return callback? err if err
            return callback? result if typeof result is 'string'

            if result and typeof result is 'object'
              # There are ops that should be applied before our new operation.
              oldOpData = (JSON.parse d for d in result)

              #console.log 'not transforming ', oldOpData
              for old in oldOpData
                opData.op = type.transform opData.op, old, 'left' if type.transform
                opData.v++
              #opData.v += oldOpData.length

              # If there's ever a problem applying the ops that have already been submitted,
              # we'll be in serious trouble.
              snapshot.data = type.apply snapshot.data, d.op for d in oldOpData

              #console.log 'retry'
              return retry()

            # Call callback with op submit version
            return callback? null, opData.v if snapshotDb.closed # Happens in the tests sometimes. Its ok.

            # Update the snapshot for queries
            snapshotDb.setSnapshot cName, docName, {v:opData.v, data:doc}, (err) ->
              return callback? err if err
              redis.publish cName, JSON.stringify {docName:docName, op:opData.op, v:opData.v}
              callback? null, opData.v

    _subscribe_channel: (channel, callback) -> # Subscribe to a redis pubsub channel and get a nodejs stream out
      # TODO: 2 refactors:
      #        - Make the redis observer we use here reusable
      #        - Reuse listens on channels
      stream = new Readable objectMode:yes

      # This function is for notifying us that the stream is empty and needs data.
      # For now, we'll just ignore the signal and assume the reader reads as fast
      # as we fill it. I could add a buffer in this function, but really I don't think
      # that is any better than the buffer implementation in nodejs streams themselves.
      stream._read = ->

      redisObserver = redisLib.createClient redis.port, redis.host, redis.options

      open = true
      stream.destroy = ->
        throw new Error 'Stream already closed' unless open
        stream.push null
        open = false
        redisObserver.unsubscribe channel
        redisObserver.quit()

      redisObserver.on 'message', (_channel, msg) ->
        assert open
        return unless _channel is channel
        data = JSON.parse msg
        stream.push data

      redisObserver.subscribe channel, (err) ->
        if err
          stream.destroy()
          callback err, null
        else
          callback null, stream

    # Callback called with (err, op stream). v must be in the past or present. Behaviour
    # with a future v is undefined (because I don't think thats an interesting case).
    subscribe: (cName, docName, v, callback) ->
      opChannel = getDocOpChannel cName, docName

      # Subscribe redis to the stream first so we don't miss out on any operations
      # while we're getting the history
      @_subscribe_channel opChannel, (err, stream) ->
        callback err if err

        # From here on, we need to call stream.destroy() if there are errors.
        getOps cName, docName, v, (err, data) ->
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
      snapshotDb.getSnapshot cName, docName, (err, snapshot) ->
        return callback? err if err
        return callback? 'Document does not exist' unless snapshot

        getOps cName, docName, snapshot.v, (err, opData) ->
          return callback? err if err
          snapshot.v += opData.length
          type = otTypes[snapshot.type]
          snapshot.data = type.apply snapshot.data, d.op for d in opData
          callback null, snapshot

    fetchAndSubscribe: (cName, docName, callback) ->
      @fetch cName, docName, (err, data) =>
        return callback err if err
        @subscribe cName, docName, data.v, (err, stream) ->
          callback err, data, stream

    query: (cName, query, callback) ->
      # subscribe to collection firehose -> cache. The firehose isn't updated until after mongo,
      # so if we get notified about an op here, the document's been saved.
      @_subscribe_channel cName, (err, stream) =>
        return callback err if err

        # Issue query on mongo to get our initial result set.
        snapshotDb.query cName, query, (err, initialResults) =>
          if err
            stream.destroy()
            return callback err
          
          #console.log results

          results = new EventEmitter
          results.data = {}
          results.destroy = ->
            stream.destroy()

          for d in initialResults
            results.data[d._id] = {data:d.data, v:d.v}

          do f = -> while d = stream.read() then do (d) ->
            cachedData = results.data[d.docName]
            # Ignore ops that are older than our data. This is possible because we subscribe before
            # issuing the query.
            return if cachedData and cachedData.v > d.v

            modifies = undefined #snapshotDb.willOpMakeDocMatchQuery cachedData?, query, d.op

            if !modifies?
              # Not sure whether the document should be in the db. Poll.
              snapshotDb.queryDoc cName, d.docName, query, (err, result) ->
                return stream.emit 'error', err if err
                modifies = result


                if modifies and !cachedData
                  # Add doc to the collection.
                  results.data[d.docName] = modifies
                  results.emit 'add', d.docName
                else if !modifies and cachedData
                  # Remove doc from collection
                  results.emit 'remove', d.docName
                  delete results.data[d.docName]

            #if modifies is true and !cachedData?
            # Add document. Not sure how to han


          # for each op in cache + firehose when op not older than query result
          #   check if op modifies collection.
          #     if yes or no: broadcast
          #     if unknown: issue mongo query with {_id:X}

            #console.log data

          stream.on 'readable', f

          callback null, results



    collection: (cName) ->
      create: (docName, type, initialData, meta, callback) -> client.create cName, docName, type, initialData, meta, callback
      submit: (docName, opData, callback) -> client.submit cName, docName, opData, callback
      subscribe: (docName, v, callback) -> client.subscribe cName, docName, v, callback
      fetch: (docName, callback) -> client.fetch cName, docName, callback
      fetchAndObserve: (docName, callback) -> client.fetchAndObserve cName, docName, callback
      query: (query, callback) ->
        client.query cName, query, callback
  
