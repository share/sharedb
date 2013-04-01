# Nodeunit test
mongoskin = require 'mongoskin'
redisLib = require 'redis'
alive = require './lib'

otTypes = require 'ot-types'
otTypes['json-racer'] = require './lib/mutate'

id = 0

createClient = ->
  mongo = require('mongoskin').db 'localhost:27017/test?auto_reconnect', safe:false
  mongowrapper = alive.mongo(mongo)

  redis = redisLib.createClient()
  redis.select 15

  client = alive.client mongowrapper, redis
  {client, redis, mongo, mongowrapper}

module.exports =
  setUp: (callback) ->
    {@client, @redis, @mongo, @mongowrapper} = createClient()

    # Clear the databases
    @mongo.dropCollection '_test'
    @redis.flushdb()

    @collection = @client.collection (@cName = '_test')
    @doc = "id#{id++}"
    @create = (data = {}, cb) -> # callback and data are both optional.
      [data, cb] = [{}, data] if typeof data is 'function'

      @collection.create @doc, 'json-racer', (err) =>
        op = op:'set', p:[], val:data
        @collection.submit @doc, v:0, op:op, (err, v) ->
          throw new Error err if err
          cb?()
    callback()

  tearDown: (callback) ->
    @mongowrapper.close()
    @redis.quit()
    callback()
    
  'create a doc': (test) ->
    @collection.create @doc, 'json-racer', (err) ->
      throw new Error err if err
      test.done()

  'created documents can be fetched': (test) -> @create =>
    @collection.fetch @doc, (err, {v, data}) ->
      throw new Error err if err
      test.deepEqual data, {}
      test.strictEqual v, 1
      test.done()

  'modify a document': (test) -> @create =>
    op = op:'set', p:['a'], val:'hi'
    @collection.submit @doc, v:1, op:op, (err, v) =>
      throw new Error err if err
      @collection.fetch @doc, (err, {v, data}) =>
        throw new Error err if err
        test.deepEqual data, {a:'hi'}
        test.done()

  'remove a doc': (test) -> @create =>
    op = op:'rm', p:[]
    @collection.submit @doc, v:1, op:op, (err, v) =>
      throw new Error err if err
      @collection.fetch @doc, (err, {v, data}) =>
        throw new Error err if err
        test.equal data, null
        test.done()

  'Repeated operations are not executed': (test) -> @create =>
    op = op:'set', p:[], val:{arr:[]}
    @collection.submit @doc, v:1, op:op, (err, v) =>
      throw new Error err if err
      op = op:'ins', p:['arr', 0], val:'x'
      @collection.submit @doc, v:2, id:'abc.123', op:op, (err, v) =>
        throw new Error err if err
        @collection.submit @doc, v:2, id:'abc.123', op:op, (err, v) =>
          test.strictEqual err, 'Op already submitted'
          test.done()
 
  'Observe':
    'local changes': (test) -> @create =>
      @collection.subscribe @doc, 1, (err, stream) =>
        throw new Error err if err

        op = op:'set', p:['a'], val:'hi'
        stream.on 'readable', ->
          test.deepEqual stream.read(), {v:1, op:op, id:'abc.123'}
          stream.destroy()
          test.done()

        @collection.submit @doc, v:1, op:op, id:'abc.123'

    'From an old version': (test) -> @create =>
      # The document has version 1
      @collection.subscribe @doc, 0, (err, stream) =>
        stream.once 'readable', =>
          test.deepEqual stream.read(), {v:0, op:{op:'set', p:[], val:{}}}

          # And we still get ops that come in now.
          op = op:'set', p:['a'], val:'hi'
          @collection.submit @doc, v:1, op:op, id:'abc.123'
          stream.once 'readable', ->
            test.deepEqual stream.read(), {v:1, op:op, id:'abc.123'}
            stream.destroy()
            test.done()

    'document that doesnt exist yet': (test) ->
      @collection.subscribe @doc, 0, (err, stream) =>
        stream.on 'readable', ->
          test.deepEqual stream.read(), {v:0, op:{op:'set', p:[], val:{}}}
          stream.destroy()
          test.done()

        @create()

    'double stream.destroy throws': (test) ->
      @collection.subscribe @doc, 1, (err, stream) =>
        stream.destroy()
        test.throws -> stream.destroy()
        test.done()
    
    'separate clients 1': (test) -> @create =>
      numClients = 50
      clients = (createClient() for [0...numClients])

      for c, i in clients
        c.client.submit @cName, @doc, v:1, op:{op:'ins', p:['x', -1], val:i}

      @collection.subscribe @doc, 1, (err, stream) =>
        # We should get numClients ops on the stream, in order.
        seq = 1
        stream.on 'readable', tryRead = =>
          data = stream.read()
          return unless data
          #console.log 'read', data
          delete data.op.val
          test.deepEqual data, {v:seq, op:{op:'ins', p:['x', -1]}}

          if seq is numClients
            #console.log 'destroy stream'
            stream.destroy()

            for c, i in clients
              c.redis.quit()
              c.mongowrapper.close()
            test.done()

            # Uncomment to see the actually submitted data
            #@collection.fetch @doc, (err, {v, data}) =>
            #  console.log data
          else
            seq++

          tryRead()

  'Query':
    'returns a result it already applies to': (test) -> @create {x:5}, =>
      @collection.query {x:5}, (err, results) =>
        expected = {}
        expected[@doc] = {data:{x:5}, v:0}
        test.deepEqual results.data, expected
        results.destroy()
        test.done()

    'Something with no results gets an empty result set': (test) ->
      @collection.query {xyz:123}, (err, results) ->
        test.deepEqual results.data, {}
        results.on 'add', -> throw new Error 'should not have added results'

        process.nextTick ->
          results.destroy()
          test.done()


    'with a specified _id is invalid': (test) ->
      @collection.query {_id:123}, (err, results) ->
        test.ok err
        test.equals results, null
        test.done()

    ###
    'add an element when it matches': (test) ->
      @collection.query {x:5}, (err, results) =>
        @create {x:5}

        results.on 'add', (docName) =>
          test.strictEqual docName, @doc
          expected = {}
          expected[@doc] = {data:{x:5}, v:0}
          test.deepEqual results.data, expected

          results.destroy()
          test.done()
    ###
    'remove an element that no longer matches': (test) -> @create {x:5}, =>
      @collection.query {x:5}, (err, results) =>
        results.on 'remove', (docName) =>
          test.strictEqual docName, @doc

          # The doc is left in the result set until after the callback runs so
          # we can read doc stuff off here.
          process.nextTick ->
            test.equal results.data[@doc], null
            
            results.destroy()
            test.done()

        op = op:'rm', p:[]
        @collection.submit @doc, v:1, op:op, (err, v) =>

    'Destroyed query set should not receive events': (test) ->
      @collection.query {x:5}, (err, results) =>
        results.on 'add', -> throw new Error 'add called after destroy'
        results.on 'remove', -> throw new Error 'remove called after destroy'

        results.destroy()
        setTimeout (-> test.done()), 10

        # Sooo tasty. results... you know you want this delicious document.
        @create {x:5}, =>
          op = op:'rm', p:[]
          @collection.submit @doc, v:1, op:op



###

    'Updated documents have updated result data if follow:true': (test) ->

    'Pagination': (test) ->
###
