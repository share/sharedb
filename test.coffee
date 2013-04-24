# Mocha test
mongoskin = require 'mongoskin'
redisLib = require 'redis'
livedb = require './lib'
assert = require 'assert'

otTypes = require 'ot-types'
#otTypes['json-racer'] = require './lib/mutate'

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
    @create = (data = '', cb) -> # callback and data are both optional.
      [data, cb] = ['', data] if typeof data is 'function'

      type = if typeof data is 'string' then 'text' else 'json0'
      @collection.submit @doc, {v:0, create:{type, data}}, (err) ->
        throw new Error err if err
        cb?()

  afterEach ->
    @mongowrapper.close()
    @redis.quit()
    
  it 'creates a doc', (done) ->
    @collection.submit @doc, {v:0, create:{type:'text'}}, (err) ->
      throw new Error err if err
      done()

  it 'can fetch created documents', (done) -> @create 'hi', =>
    @collection.fetch @doc, (err, {v, data}) ->
      throw new Error err if err
      assert.deepEqual data, 'hi'
      assert.strictEqual v, 1
      done()

  it 'can modify a document', (done) -> @create =>
    @collection.submit @doc, v:1, op:['hi'], (err, v) =>
      throw new Error err if err
      @collection.fetch @doc, (err, {v, data}) =>
        throw new Error err if err
        assert.deepEqual data, 'hi'
        done()

  it 'removes a doc', (done) -> @create =>
    @collection.submit @doc, v:1, del:true, (err, v) =>
      throw new Error err if err
      @collection.fetch @doc, (err, data) =>
        throw new Error err if err
        assert.equal data.data, null
        assert.equal data.type, null
        done()

  it 'does not execute repeated operations', (done) -> @create =>
    @collection.submit @doc, v:1, op:['hi'], (err, v) =>
      throw new Error err if err
      op = [2, ' there']
      @collection.submit @doc, v:2, src:'abc', seq:123, op:op, (err, v) =>
        throw new Error err if err
        @collection.submit @doc, v:2, src:'abc', seq:123, op:op, (err, v) =>
          assert.strictEqual err, 'Op already submitted'
          done()

  it 'will execute concurrent operations', (done) -> @create =>
    count = 0

    callback = (err, v) =>
      assert.equal err, null
      count++
      done() if count is 2

    @collection.submit @doc, v:1, src:'abc', seq:1, op:['client 1'], callback
    @collection.submit @doc, v:1, src:'def', seq:1, op:['client 2'], callback

  describe 'Observe', ->
    it 'observes local changes', (done) -> @create =>
      @collection.subscribe @doc, 1, (err, stream) =>
        throw new Error err if err

        stream.on 'readable', ->
          assert.deepEqual stream.read(), {v:1, op:['hi'], src:'abc', seq:123}
          stream.destroy()
          done()

        @collection.submit @doc, v:1, op:['hi'], src:'abc', seq:123

    it 'sees ops when you observe an old version', (done) -> @create =>
      # The document has version 1
      @collection.subscribe @doc, 0, (err, stream) =>
        stream.once 'readable', =>
          assert.deepEqual stream.read(), {v:0, create:{type:otTypes.text.uri, data:''}}

          # And we still get ops that come in now.
          @collection.submit @doc, v:1, op:['hi'], src:'abc', seq:123
          stream.once 'readable', ->
            assert.deepEqual stream.read(), {v:1, op:['hi'], src:'abc', seq:123}
            stream.destroy()
            done()

    it 'can observe a document that doesnt exist yet', (done) ->
      @collection.subscribe @doc, 0, (err, stream) =>
        stream.on 'readable', ->
          assert.deepEqual stream.read(), {v:0, create:{type:otTypes.text.uri, data:''}}
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
        c.client.submit @cName, @doc, v:1, op:["client #{i} "]

      @collection.subscribe @doc, 1, (err, stream) =>
        # We should get numClients ops on the stream, in order.
        seq = 1
        stream.on 'readable', tryRead = =>
          data = stream.read()
          return unless data
          #console.log 'read', data
          #console.log data.op
          delete data.op
          assert.deepEqual data, {v:seq} #, op:{op:'ins', p:['x', -1]}}

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
      @collection.query {'data.x':5}, (err, results) =>
        expected = {}
        expected[@doc] = {data:{x:5}, type:otTypes.json0.uri, v:1}
        assert.deepEqual results.data, expected
        results.destroy()
        done()

    it 'gets an empty result set when you query something with no results', (done) ->
      @collection.query {'data.xyz':123}, (err, results) ->
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
      @collection.query {'data.x':5}, (err, results) =>
        @create {x:5}

        results.on 'add', (docName) =>
          assert.strictEqual docName, @doc
          expected = {}
          expected[@doc] = {data:{x:5}, v:1}
          assert.deepEqual results.data, expected

          results.destroy()
          done()
    
    it 'remove an element that no longer matches', (done) -> @create {x:5}, =>
      @collection.query {'data.x':5}, (err, results) =>
        results.on 'remove', (docName) =>
          assert.strictEqual docName, @doc

          # The doc is left in the result set until after the callback runs so
          # we can read doc stuff off here.
          process.nextTick ->
            assert.equal results.data[@doc], null
            
            results.destroy()
            done()

        op = op:'rm', p:[]
        @collection.submit @doc, v:1, op:[{p:['x'], od:5, oi:6}], (err, v) =>

    it 'does not emit receive events to a destroyed query', (done) ->
      @collection.query {'data.x':5}, (err, results) =>
        results.on 'add', -> throw new Error 'add called after destroy'
        results.on 'remove', -> throw new Error 'remove called after destroy'

        results.destroy()

        # Sooo tasty. results... you know you want this delicious document.
        @create {x:5}, ->
          setTimeout (-> done()), 20

    it.skip 'Updated documents have updated result data if follow:true', (done) ->

    it.skip 'Pagination', (done) ->

    it.skip 'Creating with no type errors out', ->

    it.skip 'Fails to apply an operation to a document that was deleted and recreated', ->

