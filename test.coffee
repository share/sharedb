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

    @cName = '_test'

    # Clear the databases
    mongo = mongoskin.db 'localhost:27017/test?auto_reconnect', safe:true
    mongo.dropCollection @cName
    @redis.flushdb()

    @collection = @client.collection @cName
    @docName = "id#{id++}"
    @create2 = (docName, data = '', cb) ->
      [data, cb] = ['', data] if typeof data is 'function'

      type = if typeof data is 'string' then 'text' else 'json0'
      @collection.submit docName, {v:0, create:{type, data}}, (err) ->
        throw new Error err if err
        cb?()

    # callback and data are both optional.
    @create = (data, cb) -> @create2 @docName, data, cb

  afterEach ->
    @mongowrapper.close()
    @redis.quit()
    
  it 'creates a doc', (done) ->
    @collection.submit @docName, {v:0, create:{type:'text'}}, (err) ->
      throw new Error err if err
      done()

  it 'allows create ops with a null version', (done) ->
    @collection.submit @docName, {v:null, create:{type:'text'}}, (err) ->
      throw new Error err if err
      done()

  it 'errors if you dont specify a type', (done) ->
    @collection.submit @docName, {v:0, create:{}}, (err) ->
      assert.ok err
      done()

  it 'can fetch created documents', (done) -> @create 'hi', =>
    @collection.fetch @docName, (err, {v, data}) ->
      throw new Error err if err
      assert.deepEqual data, 'hi'
      assert.strictEqual v, 1
      done()

  it 'can modify a document', (done) -> @create =>
    @collection.submit @docName, v:1, op:['hi'], (err, v) =>
      throw new Error err if err
      @collection.fetch @docName, (err, {v, data}) =>
        throw new Error err if err
        assert.deepEqual data, 'hi'
        done()

  it 'returns transformed documents', (done) -> @create =>
    @collection.submit @docName, v:1, op:['a'], src:'abc', seq:123, (err, v, ops) =>
      assert.deepEqual ops, []
      @collection.submit @docName, v:1, op:['b'], (err, v, ops) =>
        assert.deepEqual ops, [{v:1, op:['a'], src:'abc', seq:123}]
        done()

  it 'allows ops with a null version', (done) -> @create =>
    @collection.submit @docName, v:null, op:['hi'], (err, v) =>
      throw new Error err if err
      @collection.fetch @docName, (err, {v, data}) =>
        throw new Error err if err
        assert.deepEqual data, 'hi'
        done()

  it 'removes a doc', (done) -> @create =>
    @collection.submit @docName, v:1, del:true, (err, v) =>
      throw new Error err if err
      @collection.fetch @docName, (err, data) =>
        throw new Error err if err
        assert.equal data.data, null
        assert.equal data.type, null
        done()

  it 'does not execute repeated operations', (done) -> @create =>
    @collection.submit @docName, v:1, op:['hi'], (err, v) =>
      throw new Error err if err
      op = [2, ' there']
      @collection.submit @docName, v:2, src:'abc', seq:123, op:op, (err, v) =>
        throw new Error err if err
        @collection.submit @docName, v:2, src:'abc', seq:123, op:op, (err, v) =>
          assert.strictEqual err, 'Op already submitted'
          done()

  it 'will execute concurrent operations', (done) -> @create =>
    count = 0

    callback = (err, v) =>
      assert.equal err, null
      count++
      done() if count is 2

    @collection.submit @docName, v:1, src:'abc', seq:1, op:['client 1'], callback
    @collection.submit @docName, v:1, src:'def', seq:1, op:['client 2'], callback

  describe 'Observe', ->
    it 'observes local changes', (done) -> @create =>
      @collection.subscribe @docName, 1, (err, stream) =>
        throw new Error err if err

        stream.on 'readable', ->
          assert.deepEqual stream.read(), {v:1, op:['hi'], src:'abc', seq:123}
          stream.destroy()
          done()

        @collection.submit @docName, v:1, op:['hi'], src:'abc', seq:123

    it 'sees ops when you observe an old version', (done) -> @create =>
      # The document has version 1
      @collection.subscribe @docName, 0, (err, stream) =>
        stream.once 'readable', =>
          assert.deepEqual stream.read(), {v:0, create:{type:otTypes.text.uri, data:''}}

          # And we still get ops that come in now.
          @collection.submit @docName, v:1, op:['hi'], src:'abc', seq:123
          stream.once 'readable', ->
            assert.deepEqual stream.read(), {v:1, op:['hi'], src:'abc', seq:123}
            stream.destroy()
            done()

    it 'can observe a document that doesnt exist yet', (done) ->
      @collection.subscribe @docName, 0, (err, stream) =>
        stream.on 'readable', ->
          assert.deepEqual stream.read(), {v:0, create:{type:otTypes.text.uri, data:''}}
          stream.destroy()
          done()

        @create()

    it 'throws when you double stream.destroy', (done) ->
      @collection.subscribe @docName, 1, (err, stream) =>
        stream.destroy()
        assert.throws -> stream.destroy()
        done()
    
    it 'works with separate clients', (done) -> @create =>
      numClients = 10 # You can go way higher, but it gets slow.
      clients = (createClient() for [0...numClients])

      for c, i in clients
        c.client.submit @cName, @docName, v:1, op:["client #{i} "]

      @collection.subscribe @docName, 1, (err, stream) =>
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
            #@collection.fetch @docName, (err, {v, data}) =>
            #  console.log data
          else
            seq++

          tryRead()

  describe 'Query', ->
    # Do these tests with polling turned on and off.
    for poll in [false, true] then do (poll) -> describe "poll:#{poll}", ->
      opts = {poll}

      it 'returns a result it already applies to', (done) -> @create {x:5}, =>
        @collection.query {'data.x':5}, opts, (err, emitter) =>
          expected = [docName:@docName, data:{x:5}, type:otTypes.json0.uri, v:1]
          assert.deepEqual emitter.data, expected
          emitter.destroy()
          done()

      it 'gets an empty result set when you query something with no results', (done) ->
        @collection.query {'data.xyz':123}, opts, (err, emitter) ->
          assert.deepEqual emitter.data, []
          emitter.on 'add', -> throw new Error 'should not have added results'

          process.nextTick ->
            emitter.destroy()
            done()

      it 'adds an element when it matches', (done) ->
        @collection.query {'data.x':5}, opts, (err, emitter) =>
          emitter.on 'add', (data, idx) =>
            assert.deepEqual data, {docName:@docName, v:1, data:{x:5}, type:otTypes.json0.uri}
            assert.strictEqual idx, 0

            emitter.destroy()
            done()
      
          @create {x:5}

      it 'remove an element that no longer matches', (done) -> @create {x:5}, =>
        @collection.query {'data.x':5}, opts, (err, emitter) =>
          emitter.on 'remove', (doc, idx) =>
            assert.strictEqual idx, 0
            assert.strictEqual doc.docName, @docName

            # The doc is left in the result set until after the callback runs so
            # we can read doc stuff off here.
            process.nextTick ->
              assert.deepEqual emitter.data, []
              
              emitter.destroy()
              done()

          op = op:'rm', p:[]
          @collection.submit @docName, v:1, op:[{p:['x'], od:5, oi:6}], (err, v) =>

      it 'does not emit receive events to a destroyed query', (done) ->
        @collection.query {'data.x':5}, opts, (err, emitter) =>
          emitter.on 'add', -> throw new Error 'add called after destroy'
          emitter.on 'remove', -> throw new Error 'remove called after destroy'

          emitter.destroy()

          # Sooo tasty. emitter... you know you want this delicious document.
          @create {x:5}, ->
            setTimeout (-> done()), 20

    describe 'pagination', ->
      beforeEach (callback) ->
        @create2 '_p1', {x:5, i:1}, => @create2 '_p2', {x:5, i:2}, => @create2 '_p3', {x:5, i:3}, => callback()

      it 'respects limit queries', (done) ->
        @collection.query {$query:{'data.x':5}, $orderby:{'data.i':1}, $limit:1}, {poll:true}, (err, emitter) ->
          assert.strictEqual emitter.data.length, 1
          assert.strictEqual emitter.data[0].docName, '_p1'
          done()

      it 'respects skips', (done) ->
        @collection.query {$query:{'data.x':5}, $orderby:{'data.i':1}, $limit:1, $skip:1}, {poll:true}, (err, emitter) ->
          assert.strictEqual emitter.data.length, 1
          assert.strictEqual emitter.data[0].docName, '_p2'
          done()

      it 'will insert an element in the set', (done) ->
        @collection.query {$query:{'data.x':5}, $orderby:{'data.i':1}}, {poll:true}, (err, emitter) =>
          assert.equal emitter.data.length, 3

          emitter.on 'add', (data, idx) ->
            assert.deepEqual data, {docName:'_p4', type:otTypes.json0.uri, v:1, data:{x:5, i:1.5}}
            assert.deepEqual idx, 1
            assert.strictEqual data, emitter.data[1]
            assert.strictEqual emitter.data.length, 4

            done()

          @create2 '_p4', {x:5, i:1.5}
      
      it 'will remove an element from the set', (done) ->
        @collection.query {$query:{'data.x':5}, $orderby:{'data.i':1}}, {poll:true}, (err, emitter) =>

          emitter.once 'remove', (data, idx) ->
            assert.strictEqual idx, 0
            assert.strictEqual data.docName, '_p1'
            emitter.once 'remove', (data, idx) ->
              assert.strictEqual idx, 1
              assert.strictEqual data.docName, '_p3'

              process.nextTick ->
                assert.strictEqual emitter.data.length, 1
                assert.strictEqual emitter.data[0].docName, '_p2'
                done()

          # I'll delete the first _and_ last elements to be sure, and do it in this order.
          @collection.submit '_p1', v:1, del:true, (err, v) =>
            throw err if err
            @collection.submit '_p3', v:1, del:true, (err, v) =>
              throw err if err



  it.skip 'Fails to apply an operation to a document that was deleted and recreated', ->

