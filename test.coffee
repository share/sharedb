# Mocha test
mongoskin = require 'mongoskin'
redisLib = require 'redis'
livedb = require './lib'
assert = require 'assert'

otTypes = require 'ot-types'
otTypes['json-racer'] = require './lib/mutate'

id = 0

createClient = ->
  mongowrapper = livedb.mongo('localhost:27017/test?auto_reconnect', safe:false)

  redis = redisLib.createClient()
  redis.select 15

  client = livedb.client mongowrapper, redis
  {client, redis, mongowrapper}

describe 'livedb', ->
  beforeEach ->
    {@client, @redis, @mongowrapper} = createClient()

    # Clear the databases
    mongo = mongoskin.db 'localhost:27017/test?auto_reconnect', safe:true
    mongo.dropCollection '_test'
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

  afterEach ->
    @mongowrapper.close()
    @redis.quit()
    
  it 'creates a doc', (done) ->
    @collection.create @doc, 'json-racer', (err) ->
      throw new Error err if err
      done()

  it 'can fetch created documents', (done) -> @create =>
    @collection.fetch @doc, (err, {v, data}) ->
      throw new Error err if err
      assert.deepEqual data, {}
      assert.strictEqual v, 1
      done()

  it 'can modify a document', (done) -> @create =>
    op = op:'set', p:['a'], val:'hi'
    @collection.submit @doc, v:1, op:op, (err, v) =>
      throw new Error err if err
      @collection.fetch @doc, (err, {v, data}) =>
        throw new Error err if err
        assert.deepEqual data, {a:'hi'}
        done()

  it 'removes a doc', (done) -> @create =>
    op = op:'rm', p:[]
    @collection.submit @doc, v:1, op:op, (err, v) =>
      throw new Error err if err
      @collection.fetch @doc, (err, {v, data}) =>
        throw new Error err if err
        assert.equal data, null
        done()

  it 'does not execute repeated operations', (done) -> @create =>
    op = op:'set', p:[], val:{arr:[]}
    @collection.submit @doc, v:1, op:op, (err, v) =>
      throw new Error err if err
      op = op:'ins', p:['arr', 0], val:'x'
      @collection.submit @doc, v:2, id:'abc.123', op:op, (err, v) =>
        throw new Error err if err
        @collection.submit @doc, v:2, id:'abc.123', op:op, (err, v) =>
          assert.strictEqual err, 'Op already submitted'
          done()
  describe 'Observe', ->
    it 'observes local changes', (done) -> @create =>
      @collection.subscribe @doc, 1, (err, stream) =>
        throw new Error err if err

        op = op:'set', p:['a'], val:'hi'
        stream.on 'readable', ->
          assert.deepEqual stream.read(), {v:1, op:op, id:'abc.123'}
          stream.destroy()
          done()

        @collection.submit @doc, v:1, op:op, id:'abc.123'

    it 'sees ops when you observe an old version', (done) -> @create =>
      # The document has version 1
      @collection.subscribe @doc, 0, (err, stream) =>
        stream.once 'readable', =>
          assert.deepEqual stream.read(), {v:0, op:{op:'set', p:[], val:{}}}

          # And we still get ops that come in now.
          op = op:'set', p:['a'], val:'hi'
          @collection.submit @doc, v:1, op:op, id:'abc.123'
          stream.once 'readable', ->
            assert.deepEqual stream.read(), {v:1, op:op, id:'abc.123'}
            stream.destroy()
            done()

    it 'can observe a document that doesnt exist yet', (done) ->
      @collection.subscribe @doc, 0, (err, stream) =>
        stream.on 'readable', ->
          assert.deepEqual stream.read(), {v:0, op:{op:'set', p:[], val:{}}}
          stream.destroy()
          done()

        @create()

    it 'throws when you double stream.destroy', (done) ->
      @collection.subscribe @doc, 1, (err, stream) =>
        stream.destroy()
        assert.throws -> stream.destroy()
        done()
    
    it 'works with separate clients', (done) -> @create =>
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
          assert.deepEqual data, {v:seq, op:{op:'ins', p:['x', -1]}}

          if seq is numClients
            #console.log 'destroy stream'
            stream.destroy()

            for c, i in clients
              c.redis.quit()
              c.mongowrapper.close()
            done()

            # Uncomment to see the actually submitted data
            #@collection.fetch @doc, (err, {v, data}) =>
            #  console.log data
          else
            seq++

          tryRead()

  describe 'Query', ->
    it 'returns a result it already applies to', (done) -> @create {x:5}, =>
      @collection.query {x:5}, (err, results) =>
        expected = {}
        expected[@doc] = {data:{x:5}, v:0}
        assert.deepEqual results.data, expected
        results.destroy()
        done()

    it 'gets an empty result set when you query something with no results', (done) ->
      @collection.query {xyz:123}, (err, results) ->
        assert.deepEqual results.data, {}
        results.on 'add', -> throw new Error 'should not have added results'

        process.nextTick ->
          results.destroy()
          done()

    it 'gives you an error when you specify _id', (done) ->
      @collection.query {_id:123}, (err, results) ->
        assert.ok err
        assert.equal results, null
        done()

    it.skip 'adds an element when it matches', (done) ->
      @collection.query {x:5}, (err, results) =>
        @create {x:5}

        results.on 'add', (docName) =>
          assert.strictEqual docName, @doc
          expected = {}
          expected[@doc] = {data:{x:5}, v:0}
          assert.deepEqual results.data, expected

          results.destroy()
          done()
    
    it 'remove an element that no longer matches', (done) -> @create {x:5}, =>
      @collection.query {x:5}, (err, results) =>
        results.on 'remove', (docName) =>
          assert.strictEqual docName, @doc

          # The doc is left in the result set until after the callback runs so
          # we can read doc stuff off here.
          process.nextTick ->
            assert.equal results.data[@doc], null
            
            results.destroy()
            done()

        op = op:'rm', p:[]
        @collection.submit @doc, v:1, op:op, (err, v) =>

    it 'does not emit receive events to a destroyed query', (done) ->
      @collection.query {x:5}, (err, results) =>
        results.on 'add', -> throw new Error 'add called after destroy'
        results.on 'remove', -> throw new Error 'remove called after destroy'

        results.destroy()
        setTimeout (-> done()), 10

        # Sooo tasty. results... you know you want this delicious document.
        @create {x:5}, =>
          op = op:'rm', p:[]
          @collection.submit @doc, v:1, op:op




    #'Updated documents have updated result data if follow:true', (done) ->

    #'Pagination', (done) ->
###
