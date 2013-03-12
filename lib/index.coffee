{EventEmitter} = require 'events'
assert = require 'assert'
mutate = require './mutate'
redisLib = require 'redis'

exports.mongo = require './mongo'

exports.client = (snapshotDb, redis) ->
  opLogKey = (cName, docName) -> "#{cName}.#{docName} ops"
  getOpChannel = (cName, docName) -> "#{cName}.#{docName}"

  # Non inclusive - gets ops from [from, to). Ie, all relevant ops. If to is not defined
  # (null or undefined) then it returns all ops.
  getOps = (cName, docName, from, to, callback) ->
    [to, callback] = [-1, to] if typeof to is 'function'
    to ?= -1

    if to >= 0
      return callback? null, [] if from >= to
      to--

    redis.lrange opLogKey(cName, docName), from, to, (err, values) ->
      return callback? err if err
      ops = for value in values
        op = JSON.parse value
        op.v = from++ # The version is stripped from the ops in the oplog. Add it back.
        op
      callback null, ops

  redisSubmit = (cName, docName, opData, callback) ->
    logEntry = JSON.stringify {op:opData.op, id:opData.id}
    pubEntry = JSON.stringify opData # Publish everything.

    if opData.id
      pair = opData.id.split '.'
      # I could say seq = parseInt pair[1], 10 ... but it'll be converted to a string by redis anyway.
      seq = pair[1]
      clientNonceKey = "c #{pair[0]}"

    redis.eval """
-- ops here is a JSON string.
local clientNonceKey, opLogKey, opChannel = unpack(KEYS)
local seq, v, logEntry, pubEntry = unpack(ARGV) -- From redisSubmit, below.
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
redis.call('PUBLISH', opChannel, pubEntry)
    """, 3, clientNonceKey, opLogKey(cName, docName), getOpChannel(cName, docName), seq, opData.v, logEntry, pubEntry, callback

  client =
    submit: (cName, docName, opData, callback) ->
      return callback new Error 'missing version' unless typeof opData.v is 'number'
      return callback new Error 'missing op' unless typeof (opData.op or opData.ops) is 'object'

      # Get doc snapshot. We don't need it for transform, but we will
      # try to apply the operation before saving it.
      @fetch cName, docName, (err, snapshot) ->
        return callback? err if err
        
        # Just eagarly try to submit to redis. If this fails, redis will return all the ops we need to
        # 'transform' by.
        do retry = ->
          if snapshot.v is opData.v
            try
              doc = mutate.apply snapshot.data, opData.op
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

              #  --- don't transform for now! ---
              opData.v += oldOpData.length

              # If there's ever a problem applying the ops that have already been submitted,
              # we'll be in serious trouble.
              snapshot.data = mutate.apply snapshot.data, d.op for d in oldOpData

              #console.log 'retry'
              return retry()

            # Call callback with op submit version
            callback? null, opData.v
            # Update the snapshot if we feel like it.
            if Math.random() < 0.1
              snapshotDb.setSnapshot cName, docName, opData.v, doc

    observe: (cName, docName, v, callback) ->
      stream = new EventEmitter

      opChannel = getOpChannel cName, docName
      redisObserver = redisLib.createClient redis.port, redis.host, redis.options

      open = true
      stream.end = ->
        throw new Error 'Stream already closed' unless open
        stream.emit 'close'
        open = false
        try redisObserver?.quit()

      # Subscribe redis to the stream first so we don't miss out on any operations
      # while we're getting the history
      queue = []
      redisObserver.on 'message', (channel, msg) ->
        assert open
        return unless channel is opChannel
        opData = JSON.parse msg

        if queue
          queue.push opData
        else
          assert opData.v is v
          v++
          stream.emit 'op', opData

      redisObserver.subscribe opChannel, (err) ->
        if err
          try redisObserver.quit()
          return callback? err

        # Get all ops from v to current
        getOps cName, docName, v, (err, data) ->
          if err
            try redisObserver.quit()
            return callback? err

          callback? null, stream

          # First send all the operations between v and when we called getOps
          for d in data
            assert d.v is v
            v++
            stream.emit 'op', d
          # Then all the ops between then and now..
          for d in queue when d.v >= v
            assert d.v is v
            v++
            stream.emit 'op', d
          # Mark all future ops on the stream to go straight to the stream.
          queue = null

    fetch: (cName, docName, callback) ->
      snapshotDb.getSnapshot cName, docName, (err, snapshot) ->
        return callback? err if err
        snapshot ?= {v:0, data:null}

        getOps cName, docName, snapshot.v, (err, opData) ->
          return callback? err if err
          snapshot.v += opData.length
          snapshot.data = mutate.apply snapshot.data, d.op for d in opData
          callback null, snapshot

    fetchAndObserve: (cName, docName, callback) ->
      @fetch cName, docName, (err, data) =>
        return callback err if err
        @observe cName, docName, data.v, (err, stream) ->
          callback err, data, stream

    query: (q, callback) ->
      throw new Error 'query not implemented'

    collection: (cName) ->
      submit: (docName, opData, callback) -> client.submit cName, docName, opData, callback
      observe: (docName, v, callback) -> client.observe cName, docName, v, callback
      fetch: (docName, callback) -> client.fetch cName, docName, callback
      fetchAndObserve: (docName, callback) -> client.fetchAndObserve cName, docName, callback
      query: (query, callback) ->
        query.from = cName
        client.query query, callback
  
