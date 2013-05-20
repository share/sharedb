{Readable} = require 'stream'
{EventEmitter} = require 'events'
assert = require 'assert'
redisLib = require 'redis'
ot = require './ot'

exports.mongo = require './mongo'

exports.client = (snapshotDb, redis = redisLib.createClient(), extraDbs = {}) ->
  getOpLogKey = (cName, docName) -> "#{cName}.#{docName} ops"
  getDocOpChannel = (cName, docName) -> "#{cName}.#{docName}"

  redisSubmit = (cName, docName, opData, callback) ->
    logEntry = JSON.stringify {op:opData.op, src:opData.src, seq:opData.seq, create:opData.create, del:opData.del}
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
      opData.src, getOpLogKey(cName, docName), getDocOpChannel(cName, docName), # KEYS table
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

    # Non inclusive - gets ops from [from, to). Ie, all relevant ops. If to is not defined
    # (null or undefined) then it returns all ops.
    getOps: (cName, docName, from, to, callback) ->
      [to, callback] = [-1, to] if typeof to is 'function'
      to ?= -1

      if to >= 0
        return callback? null, [] if from >= to
        to--

      #console.log 'getOps', cName, docName, "'#{getOpLogKey(cName, docName)}'"
      redis.lrange getOpLogKey(cName, docName), from, to, (err, values) ->
        return callback? err if err
        ops = for value in values
          op = JSON.parse value
          op.v = from++ # The version is stripped from the ops in the oplog. Add it back.
          op
        callback null, ops

    submit: (cName, docName, opData, callback) ->
      validate = opData.validate or (opData, snapshot, callback) -> callback()

      #console.log 'submit opdata ', opData
      err = ot.checkOpData opData
      return callback? err if err

      ot.normalize opData

      transformedOps = []

      do retry = =>
        # Get doc snapshot. We don't need it for transform, but we will
        # try to apply the operation locally before saving it.
        @fetch cName, docName, (err, snapshot) ->
          opData.v = snapshot.v if !opData.v?

          return callback? err if err
          return callback? 'Invalid version' if snapshot.v < opData.v

          trySubmit = ->
            # Eagarly try to submit to redis. If this fails, redis will return all the ops we need to
            # transform by.
            redisSubmit cName, docName, opData, (err, result) ->
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

              # And SOLR or whatever. Not entirely sure of the timing here.
              for name, db of extraDbs
                db.submit? cName, docName, opData, snapshot, (err) ->
                  console.warn "Error updating db #{db.name} #{cName}.#{docName} with new snapshot data: ", err if err

              # Call callback with op submit version
              return callback? null, opData.v, transformedOps if snapshotDb.closed # Happens in the tests sometimes. Its ok.

              # Update the snapshot for queries
              snapshotDb.setSnapshot cName, docName, snapshot, (err) ->
                return callback? err if err
                opData.docName = docName
                redis.publish cName, JSON.stringify opData
                callback? null, opData.v, transformedOps


          # If there's actually a chance of submitting, try applying the operation to make sure
          # its valid.
          if snapshot.v is opData.v
            err = ot.apply snapshot, opData
            return callback? err if err

            validate opData, snapshot, (err) ->
              return callback? err if err
              trySubmit()
          else
            trySubmit()


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
        return unless open

        stream.push null
        open = false
        redisObserver.unsubscribe channel
        redisObserver.quit()

        stream.emit 'close'
        stream.emit 'end'

      redisObserver.on 'message', (_channel, msg) ->
        # We shouldn't get messages after we tell it to unsubscribe, but its happened.
        return unless open

        return unless _channel is channel
        data = JSON.parse msg
        stream.push data

      redisObserver.subscribe channel, (err) ->
        if err
          stream.destroy() if open
          callback err, null
        else
          callback null, stream

    # Callback called with (err, op stream). v must be in the past or present. Behaviour
    # with a future v is undefined (because I don't think thats an interesting case).
    subscribe: (cName, docName, v, callback) ->
      opChannel = getDocOpChannel cName, docName

      # Subscribe redis to the stream first so we don't miss out on any operations
      # while we're getting the history
      @_subscribe_channel opChannel, (err, stream) =>
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

        @getOps cName, docName, snapshot.v, (err, opData) ->
          return callback? err if err
          err = ot.apply snapshot, d for d in opData
          callback err, snapshot

    fetchAndSubscribe: (cName, docName, callback) ->
      @fetch cName, docName, (err, data) =>
        return callback err if err
        @subscribe cName, docName, data.v, (err, stream) ->
          callback err, data, stream

    queryFetch: (cName, query, callback) ->
      snapshotDb.query cName, query, (err, results) =>
        callback err, results

    query: (cName, query, opts, callback) ->
      [opts, callback] = [{}, opts] if typeof opts is 'function'

      poll = if opts.poll is undefined
        snapshotDb.queryNeedsPollMode query
      else
        opts.poll

      # console.log 'poll mode:', !!poll

      # subscribe to collection firehose -> cache. The firehose isn't updated until after mongo,
      # so if we get notified about an op here, the document's been saved.
      @_subscribe_channel cName, (err, stream) =>
        return callback err if err

        # Issue query on mongo to get our initial result set.
        #console.log 'snapshotdb query', cName, query
        snapshotDb.query cName, query, (err, results) =>
          #console.log '-> pshotdb query', cName, query, results
          if err
            stream.destroy()
            return callback err
          
          # Maintain a map from docName -> index for constant time tests
          docIdx = {}
          docIdx[d.docName] = i for d, i in results

          emitter = new EventEmitter
          emitter.data = results
          emitter.destroy = ->
            stream.destroy()

          do f = -> while d = stream.read() then do (d) ->
            # We have some data from the channel stream about an updated document.
            #console.log d.docName, docIdx, results
            cachedData = results[docIdx[d.docName]]
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
                snapshotDb.query cName, query, (err, newResults) ->
                  # Do a simple diff, describing how to convert results -> newResults
                  #
                  # Inside the loop, we can't use any of the index values of docIdx because
                  # the index values aren't updated as the loop iterates. We _can_ use it to test
                  # existance in the result set.
                  ri = newi = 0
                  while ri < results.length and newi < newResults.length
                    currentNew = newResults[newi]
                    currentR = results[ri]

                    # 3 cases:
                    #
                    # - The current element is in the old result set and the new result set. Skip it.
                    if currentR.docName == currentNew.docName
                      ri++; newi++

                    # - newResults[newi] is not the old result set. Add it.
                    else if docIdx[currentNew.docName] is undefined
                      docIdx[currentNew.docName] = -1
                      results.splice ri, 0, currentNew
                      emitter.emit 'add', currentNew, ri
                      # Incremenet both because we spliced into results.
                      ri++; newi++

                    # - currentNew is in the result set, but skips currentR. Remove.
                    else
                      delete docIdx[currentR.docName]
                      emitter.emit 'remove', currentR, ri
                      results.splice ri, 1

                  # If there's any extra stuff in newResults, add it to results.
                  while newi < newResults.length
                    currentNew = newResults[newi]
                    results.push currentNew
                    emitter.emit 'add', currentNew, ri
                    ri++; newi++

                  # If there's extra stuff in results, remove it.
                  while ri < results.length
                    emitter.emit 'remove', results[ri], ri
                    results.splice ri, 1

                  # Fix docIdx
                  docIdx = {}
                  docIdx[d.docName] = i for d, i in results

              else
                #console.log 'query doc', cName
                snapshotDb.queryDoc cName, d.docName, query, (err, result) ->
                  return stream.emit 'error', err if err
                  #console.log 'result', result, 'cachedData', cachedData

                  if result and !cachedData
                    # Add doc to the collection. Order isn't important, so
                    # we'll just whack it at the end.
                    results.push result
                    emitter.emit 'add', result, results.length - 1
                    docIdx[result.docName] = results.length - 1
                  else if !result and cachedData
                    # Remove doc from collection
                    idx = docIdx[d.docName]
                    delete docIdx[d.docName]
                    emitter.emit 'remove', results[idx], idx
                    results.splice idx, 1
                    while idx < results.length
                      name = results[idx++].docName
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

      queryFetch: (query, callback) -> client.queryFetch cName, query, callback
      query: (query, opts, callback) -> client.query cName, query, opts, callback
  
