# Mocha test
mongoskin = require 'mongoskin'
redisLib = require 'redis'
livedb = require '../lib'
assert = require 'assert'
util = require 'util'
liveDbMongo = require 'livedb-mongo'

otTypes = require 'ottypes'
#otTypes['json-racer'] = require './lib/mutate'

id = 0

createClient = ->
  mongoWrapper = liveDbMongo 'localhost:27017/test?auto_reconnect', safe: false

  redis = redisLib.createClient()
  redis.select redis.selected_db = 15

  testWrapper = {name:'test'}
  client = livedb.client mongoWrapper, redis, {test:testWrapper}
  {client, redis, mongoWrapper, testWrapper}

describe 'livedb', ->
  beforeEach ->
    @cName = '_test'
    @cName2 = '_test2'
    @cName3 = '_test3'

    # Clear mongo
    mongo = mongoskin.db 'localhost:27017/test?auto_reconnect', safe:true
    mongo.dropCollection @cName
    mongo.dropCollection @cName2
    mongo.dropCollection @cName3
    mongo.close()

    {@client, @redis, @mongoWrapper, @testWrapper} = createClient()

    # & clear redis.
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
    @client.destroy()
    @mongoWrapper.close()
 
  describe 'submit', ->
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

    it 'can modify a document', (done) -> @create =>
      @collection.submit @docName, v:1, op:['hi'], (err, v) =>
        throw new Error err if err
        @collection.fetch @docName, (err, {v, data}) =>
          throw new Error err if err
          assert.deepEqual data, 'hi'
          done()

    it 'transforms operations', (done) -> @create =>
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

    it 'passes an error back to fetch if fetching returns a document with no version'

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

    it 'sends operations to any extra db backends', (done) ->
      @testWrapper.submit = (cName, docName, opData, snapshot, callback) =>
        assert.equal cName, @cName
        assert.equal docName, @docName
        assert.deepEqual opData, {v:0, create:{type:otTypes.text.uri, data:''}}
        assert.deepEqual snapshot, {v:1, data:"", type:otTypes.text.uri}
        done()

      @create()

    describe 'validate', ->
      it 'runs a supplied validation function on the data', (done) ->
        validationRun = no
        validate = (opData, snapshot, callback) ->
          assert.deepEqual snapshot, {v:1, data:'', type:otTypes.text.uri}
          validationRun = yes
          callback()

        @collection.submit @docName, {v:0, create:{type:'text'}, validate}, (err) ->
          assert.ok validationRun
          done()

      it 'does not submit if validation fails', (done) -> @create =>
        validate = (opData, snapshot, callback) ->
          assert.deepEqual opData.op, ['hi']
          callback 'no you!'

        @collection.submit @docName, {v:1, op:['hi'], validate}, (err) =>
          assert.equal err, 'no you!'

          @collection.fetch @docName, (err, {v, data}) =>
            throw new Error err if err
            assert.deepEqual data, ''
            done()


  describe 'fetch', ->
    it 'can fetch created documents', (done) -> @create 'hi', =>
      @collection.fetch @docName, (err, {v, data}) ->
        throw new Error err if err
        assert.deepEqual data, 'hi'
        assert.strictEqual v, 1
        done()

  describe 'getOps', ->
    it 'returns an empty list for nonexistant documents', (done) ->
      @collection.getOps @docName, 0, -1, (err, ops) ->
        throw new Error err if err
        assert.deepEqual ops, []
        done()

    it 'returns ops that have been submitted to a document', (done) -> @create =>
      @collection.submit @docName, v:1, op:['hi'], (err, v) =>
        @collection.getOps @docName, 0, 1, (err, ops) =>
          throw new Error err if err
          assert.deepEqual ops, [create:{type:otTypes.text.uri, data:''}, v:0]

          @collection.getOps @docName, 1, 2, (err, ops) ->
            throw new Error err if err
            assert.deepEqual ops, [op:['hi'], v:1]
            done()

    it 'returns all ops if to is not defined', (done) -> @create =>
      @collection.getOps @docName, 0, (err, ops) =>
        throw new Error err if err
        assert.deepEqual ops, [create:{type:otTypes.text.uri, data:''}, v:0]

        @collection.submit @docName, v:1, op:['hi'], (err, v) =>
          @collection.getOps @docName, 0, (err, ops) ->
            throw new Error err if err
            assert.deepEqual ops, [{create:{type:otTypes.text.uri, data:''}, v:0}, {op:['hi'], v:1}]
            done()

  describe 'Observe', ->
    it 'observes local changes', (done) -> @create =>
      @collection.subscribe @docName, 1, (err, stream) =>
        throw new Error err if err

        stream.on 'readable', ->
          try
            assert.deepEqual stream.read(), {v:1, op:['hi'], src:'abc', seq:123}
            stream.destroy()
            done()
          catch e
            console.error e.stack
            throw e

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

    it 'does not throw when you double stream.destroy', (done) ->
      @collection.subscribe @docName, 1, (err, stream) =>
        stream.destroy()
        stream.destroy()
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
              c.mongoWrapper.close()
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
        @collection.query {'x':5}, opts, (err, emitter) =>
          expected = [docName:@docName, data:{x:5}, type:otTypes.json0.uri, v:1, c:@cName]
          assert.deepEqual emitter.data, expected
          emitter.destroy()
          done()

      it 'gets an empty result set when you query something with no results', (done) ->
        @collection.query {'xyz':123}, opts, (err, emitter) ->
          assert.deepEqual emitter.data, []
          emitter.on 'diff', -> throw new Error 'should not have added results'

          process.nextTick ->
            emitter.destroy()
            done()

      it 'adds an element when it matches', (done) ->
        @collection.query {'x':5}, opts, (err, emitter) =>
          emitter.on 'diff', (diff) =>
            assert.deepEqual diff, [
              index: 0
              values: [c:@cName, docName:@docName, v:1, data:{x:5}, type:otTypes.json0.uri]
              type: 'insert'
            ]

            emitter.destroy()
            done()
      
          @create {x:5}

      #console.log util.inspect diff, colors:yes, depth:null
      it 'remove an element that no longer matches', (done) -> @create {x:5}, =>
        @collection.query {'x':5}, opts, (err, emitter) =>
          emitter.on 'diff', (diff) =>
            assert.deepEqual diff, [type:'remove', index:0, howMany:1]

            # The doc is left in the result set until after the callback runs so
            # we can read doc stuff off here.
            process.nextTick ->
              assert.deepEqual emitter.data, []
              
              emitter.destroy()
              done()

          op = op:'rm', p:[]
          @collection.submit @docName, v:1, op:[{p:['x'], od:5, oi:6}], (err, v) =>

      it 'removes deleted elements', (done) -> @create {x:5}, =>
        @collection.query {'x':5}, opts, (err, emitter) =>
          assert.strictEqual emitter.data.length, 1

          emitter.on 'diff', (diff) =>
            assert.deepEqual diff, [type:'remove', index:0, howMany:1]
            process.nextTick ->
              assert.deepEqual emitter.data, []
              emitter.destroy()
              done()

          @collection.submit @docName, v:1, del:true, (err, v) =>
            throw new Error err if err

      it 'does not emit receive events to a destroyed query', (done) ->
        @collection.query {'x':5}, opts, (err, emitter) =>
          emitter.on 'diff', -> throw new Error 'add called after destroy'

          emitter.destroy()

          # Sooo tasty. emitter... you know you want this delicious document.
          @create {x:5}, ->
            setTimeout (-> done()), 20

      it 'works if you remove then re-add a document from a query' # Regression.
      

    describe 'pagination', ->
      beforeEach (callback) ->
        @create2 '_p1', {x:5, i:1}, => @create2 '_p2', {x:5, i:2}, => @create2 '_p3', {x:5, i:3}, => callback()

      it 'respects limit queries', (done) ->
        @collection.query {$query:{'x':5}, $orderby:{'i':1}, $limit:1}, {poll:true}, (err, emitter) ->
          assert.strictEqual emitter.data.length, 1
          assert.strictEqual emitter.data[0].docName, '_p1'
          done()

      it 'respects skips', (done) ->
        @collection.query {$query:{'x':5}, $orderby:{'i':1}, $limit:1, $skip:1}, {poll:true}, (err, emitter) ->
          assert.strictEqual emitter.data.length, 1
          assert.strictEqual emitter.data[0].docName, '_p2'
          done()

      it 'will insert an element in the set', (done) ->
        @collection.query {$query:{'x':5}, $orderby:{'i':1}}, {poll:true}, (err, emitter) =>
          assert.equal emitter.data.length, 3

          emitter.on 'diff', (diff) =>
            assert.deepEqual diff, [
              index: 1
              values: [{c:@cName, docName:'_p4', type:otTypes.json0.uri, v:1, data:{x:5, i:1.5}}]
              type: 'insert'
            ]
            assert.strictEqual emitter.data.length, 4

            done()

          @create2 '_p4', {x:5, i:1.5}
      
      it 'will remove an element from the set', (done) ->
        @collection.query {$query:{'x':5}, $orderby:{'i':1}}, {poll:true}, (err, emitter) =>
          emitter.once 'diff', (diff) ->
            assert.deepEqual diff, [type:'remove', index:0, howMany:1]
            emitter.once 'diff', (diff) ->
              assert.deepEqual diff, [type:'remove', index:1, howMany:1]

              process.nextTick ->
                assert.strictEqual emitter.data.length, 1
                assert.strictEqual emitter.data[0].docName, '_p2'
                done()

          # I'll delete the first _and_ last elements to be sure, and do it in this order.
          @collection.submit '_p1', v:1, del:true, (err, v) =>
            throw err if err
            @collection.submit '_p3', v:1, del:true, (err, v) =>
              throw err if err

    describe 'queryFetch', ->
      it 'query fetch with no results works', (done) ->
        @collection.queryFetch {'somekeythatdoesnotexist':1}, (err, results) ->
          throw new Error err if err
          assert.deepEqual results, []
          done()

      it 'query with some results returns those results', (done) -> @create2 @docName, 'qwertyuiop', =>
        @collection.queryFetch {'_data':'qwertyuiop'}, (err, results) =>
          expected = [docName:@docName, data:'qwertyuiop', type:otTypes.text.uri, v:1]
          assert.deepEqual results, expected
          done()

      it 'does the right thing with a backend that returns extra data'

    describe 'selected collections', ->
      it 'asks the db to pick the interesting collections'

      it 'gets operations submitted to any specified collection', (done) ->
        @testWrapper.subscribedChannels = (cName, query, opts) =>
          assert.strictEqual cName, 'internet'
          assert.deepEqual query, {x:5}
          assert.deepEqual opts, {sexy:true, backend:'test'}
          [@cName, @cName2]

        called = 0
        @testWrapper.query = (livedb, cName, query, callback) ->
          # This should get called three times:
          # When client.query is called initially and when the c1 and c2 documents are created
          called++
          assert called <= 3

          assert.deepEqual query, {x:5}
          callback null, []

          if called is 3
            done()

        @client.query 'internet', {x:5}, {sexy:true, backend:'test'}, (err) =>
          throw Error err if err
          @client.submit @cName, @docName, {v:0, create:{type:otTypes.text.uri}}, (err) => throw new Error err if err
          @client.submit @cName2, @docName, {v:0, create:{type:otTypes.text.uri}}, (err) => throw new Error err if err
          @client.submit @cName3, @docName, {v:0, create:{type:otTypes.text.uri}}

      it 'calls submit on the extra collections'

      it 'can call publish'

    describe 'extra data', ->
      it 'gets extra data in the initial result set', (done) ->
        @testWrapper.query = (client, cName, query, callback) ->
          callback null, {results:[], extra:{x:5}}

        @client.query 'internet', {x:5}, {backend:'test'}, (err, stream) =>
          assert.deepEqual stream.extra, {x:5}
          done()

      it 'gets updated extra data when the result set changes', (done) ->
        x = 1
        @testWrapper.query = (client, cName, query, callback) ->
          callback null, {results:[], extra:{x:x++}}

        @collection.query {x:5}, {backend:'test'}, (err, stream) =>
          assert.deepEqual stream.extra, {x:1}
          
          stream.on 'extra', (extra) ->
            assert.deepEqual extra, {x:2}
            done()

          @create()


    it 'turns poll mode on or off automatically if opts.poll is undefined'


  it 'Fails to apply an operation to a document that was deleted and recreated'

  it 'correctly namespaces pubsub operations so other collections dont get confused'


