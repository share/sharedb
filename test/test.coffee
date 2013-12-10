# This used to be the whole set of tests - now some of the ancillary parts of
# livedb have been pulled out. These tests should probably be split out into
# multiple files.

redisLib = require 'redis'
livedb = require '../lib'
Memory = require '../lib/memory'
assert = require 'assert'
util = require 'util'
sinon = require 'sinon'

otTypes = require 'ottypes'

id = 0

stripTs = (ops) ->
  if Array.isArray ops
    for op in ops
      delete op.m.ts if op.m
  else
    delete ops.m.ts if ops.m
  ops

createClient = (db = new Memory()) ->
  redis = redisLib.createClient()
  redis.select redis.selected_db = 15

  testWrapper = {name:'test'}
  client = livedb.client {db, redis, extraDbs:{test:testWrapper}}
  {client, redis, db, testWrapper}

# Snapshots we get back from livedb will have a timestamp with a
# m:{ctime:, mtime:} with the current time. We'll check the time is sometime
# between when the module is loaded and 10 seconds later. This is a bit
# brittle. It also copies functionality in ot.coffee.
checkAndStripMetadata = do ->
  before = Date.now()
  after = before + 10 * 1000
  (snapshot) ->
    assert.ok snapshot.m
    assert.ok before <= snapshot.m.ctime < after if snapshot.m.ctime
    assert.ok before <= snapshot.m.mtime < after
    delete snapshot.m.ctime
    delete snapshot.m.mtime
    snapshot

describe 'livedb', ->
  beforeEach ->
    @cName = '_test'
    @cName2 = '_test2'
    @cName3 = '_test3'

    {@client, @redis, @db, @testWrapper} = createClient()

    # & clear redis.
    @redis.flushdb()

    @collection = @client.collection @cName
    @docName = "id#{id++}"
    @create2 = (docName, data = '', cb) ->
      [data, cb] = ['', data] if typeof data is 'function'

      type = if typeof data is 'string' then 'text' else 'json0'
      @collection.submit docName, {v:0, create:{type, data}}, null, (err) ->
        throw new Error err if err
        cb?()

    # callback and data are both optional.
    @create = (data, cb) -> @create2 @docName, data, cb

  afterEach ->
    @client.destroy()
    @db.close()

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
        throw new Error err if err
        assert.deepEqual ops, []
        @collection.submit @docName, v:1, op:['b'], (err, v, ops) =>
          throw new Error err if err
          assert.deepEqual stripTs(ops), [{v:1, op:['a'], src:'abc', seq:123, m:{}}]
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

    it 'sends operations to the persistant oplog', (done) -> @create =>
      @db.getVersion @cName, @docName, (err, v) =>
        throw Error err if err
        assert.strictEqual v, 1
        @db.getOps @cName, @docName, 0, null, (err, ops) ->
          throw Error err if err
          assert.strictEqual ops.length, 1
          done()

    it 'repopulates the persistant oplog if data is missing', (done) ->
      @redis.set "#{@cName}.#{@docName} v", 2
      @redis.rpush "#{@cName}.#{@docName} ops",
        JSON.stringify({create:{type:otTypes.text.uri}}),
        JSON.stringify({op:['hi']}),
        (err) =>
          throw Error err if err
          @collection.submit @docName, v:2, op:['yo'], (err, v, ops, snapshot) =>
            throw Error err if err
            assert.strictEqual v, 2
            assert.deepEqual ops, []
            checkAndStripMetadata snapshot
            assert.deepEqual snapshot, {v:3, data:'yohi', type:otTypes.text.uri, m:{}}

            # And now the actual test - does the persistant oplog have our data?
            @db.getVersion @cName, @docName, (err, v) =>
              throw Error err if err
              assert.strictEqual v, 3
              @db.getOps @cName, @docName, 0, null, (err, ops) =>
                throw Error err if err
                assert.strictEqual ops.length, 3
                done()

    it 'sends operations to any extra db backends', (done) ->
      @testWrapper.submit = (cName, docName, opData, options, snapshot, callback) =>
        assert.equal cName, @cName
        assert.equal docName, @docName
        assert.deepEqual stripTs(opData), {v:0, create:{type:otTypes.text.uri, data:''}, m:{}}
        checkAndStripMetadata snapshot
        assert.deepEqual snapshot, {v:1, data:"", type:otTypes.text.uri, m:{}}
        done()

      @create()

    it 'works if the data in redis is missing', (done) -> @create =>
      @redis.flushdb =>
        @collection.submit @docName, v:1, op:['hi'], (err, v) =>
          throw new Error err if err
          @collection.fetch @docName, (err, {v, data}) =>
            throw new Error err if err
            assert.deepEqual data, 'hi'
            done()

    it 'ignores redis operations if the version isnt set', (done) -> @create =>
      @redis.del "#{@cName}.#{@docName} v", (err, result) =>
        throw Error err if err
        # If the key format ever changes, this test should fail instead of becoming silently ineffective
        assert.equal result, 1

        @redis.lset "#{@cName}.#{@docName} ops", 0, "junk that will crash livedb", (err) =>

          @collection.submit @docName, v:1, op:['hi'], (err, v) =>
            throw new Error err if err
            @collection.fetch @docName, (err, {v, data}) =>
              throw new Error err if err
              assert.deepEqual data, 'hi'
              done()

    it 'works if data in the oplog is missing', (done) ->
      # This test depends on the actual format in redis. Try to avoid adding
      # too many tests like this - its brittle.
      @redis.set "#{@cName}.#{@docName} v", 2
      @redis.rpush "#{@cName}.#{@docName} ops", JSON.stringify({create:{type:otTypes.text.uri}}), JSON.stringify({op:['hi']}), (err) =>
        throw Error err if err

        @collection.fetch @docName, (err, snapshot) ->
          throw Error err if err

          checkAndStripMetadata snapshot
          assert.deepEqual snapshot, {v:2, data:'hi', type:otTypes.text.uri, m:{}}
          done()


    describe 'pre validate', ->
      it 'runs a supplied pre validate function on the data', (done) ->
        validationRun = no
        preValidate = (opData, snapshot) ->
          assert.deepEqual snapshot, {v:0}
          validationRun = yes
          return

        @collection.submit @docName, {v:0, create:{type:'text'}, preValidate}, (err) ->
          assert.ok validationRun
          done()

      it 'does not submit if pre validation fails', (done) -> @create =>
        preValidate = (opData, snapshot) ->
          assert.deepEqual opData.op, ['hi']
          return 'no you!'

        @collection.submit @docName, {v:1, op:['hi'], preValidate}, (err) =>
          assert.equal err, 'no you!'

          @collection.fetch @docName, (err, {v, data}) =>
            throw new Error err if err
            assert.deepEqual data, ''
            done()

      it 'calls prevalidate on each component in turn, and applies them incrementally'


    describe 'validate', ->
      it 'runs a supplied validation function on the data', (done) ->
        validationRun = no
        validate = (opData, snapshot, callback) ->
          checkAndStripMetadata snapshot
          assert.deepEqual snapshot, {v:1, data:'', type:otTypes.text.uri, m:{}}
          validationRun = yes
          return

        @collection.submit @docName, {v:0, create:{type:'text'}, validate}, (err) ->
          assert.ok validationRun
          done()

      it 'does not submit if validation fails', (done) -> @create =>
        validate = (opData, snapshot, callback) ->
          assert.deepEqual opData.op, ['hi']
          return 'no you!'

        @collection.submit @docName, {v:1, op:['hi'], validate}, (err) =>
          assert.equal err, 'no you!'

          @collection.fetch @docName, (err, {v, data}) =>
            throw new Error err if err
            assert.deepEqual data, ''
            done()

      it 'calls validate on each component in turn, and applies them incrementally'

  describe 'fetch', ->
    it 'can fetch created documents', (done) -> @create 'hi', =>
      @collection.fetch @docName, (err, {v, data}) ->
        throw new Error err if err
        assert.deepEqual data, 'hi'
        assert.strictEqual v, 1
        done()

  describe 'bulk fetch', ->
    it 'can fetch created documents', (done) -> @create 'hi', =>
      request = {}
      request[@cName] = [@docName]
      @client.bulkFetch request, (err, data) =>
        throw new Error err if err
        expected = {} # Urgh javascript :(
        expected[@cName] = {}
        expected[@cName][@docName] = {data:'hi', v:1, type:otTypes.text.uri, m:{}}

        for cName, docs of data
          for docName, snapshot of docs
            checkAndStripMetadata snapshot

        assert.deepEqual data, expected
        done()

    # creating anyway here just 'cos.
    it 'doesnt return anything for missing documents', (done) -> @create 'hi', =>
      request = {}
      request[@cName] = ['doesNotExist']
      @client.bulkFetch request, (err, data) =>
        throw new Error err if err
        expected = {}
        expected[@cName] = {doesNotExist:{v:0}}
        assert.deepEqual data, expected
        done()

    it 'works with multiple collections', (done) -> @create 'hi', =>
      # This test fetches a bunch of documents that don't exist, but whatever.
      request =
        aaaaa: []
        bbbbb: ['a', 'b', 'c']

      request[@cName] = [@docName]
      # Adding this afterwards to make sure @cName doesn't come last in native iteration order
      request.zzzzz = ['d', 'e', 'f']

      @client.bulkFetch request, (err, data) =>
        throw new Error err if err
        expected =
          aaaaa: {}
          bbbbb: {a:{v:0}, b:{v:0}, c:{v:0}}
          zzzzz: {d:{v:0}, e:{v:0}, f:{v:0}}
        expected[@cName] = {}
        expected[@cName][@docName] = {data:'hi', v:1, type:otTypes.text.uri, m:{}}

        checkAndStripMetadata data[@cName][@docName]

        assert.deepEqual data, expected
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
          assert.deepEqual stripTs(ops), [create:{type:otTypes.text.uri, data:''}, v:0, m:{}]

          @collection.getOps @docName, 1, 2, (err, ops) ->
            throw new Error err if err
            assert.deepEqual stripTs(ops), [op:['hi'], v:1, m:{}]
            done()

    it 'puts a decent timestamp in ops', (done) ->
      # TS should be between start and end.
      start = Date.now()
      @create =>
        end = Date.now()
        @collection.getOps @docName, 0, (err, ops) ->
          throw Error(err) if err
          assert.equal ops.length, 1
          assert ops[0].m.ts >= start
          assert ops[0].m.ts <= end
          done()

    it 'puts a decent timestamp in ops which already have a m:{} field', (done) ->
      # TS should be between start and end.
      start = Date.now()
      @collection.submit @docName, {v:0, create:{type:'text'}, m:{}}, (err) =>
        throw Error(err) if err
        @collection.submit @docName, {v:1, op:['hi there'], m:{ts:123}}, (err) =>
          throw Error(err) if err

          end = Date.now()
          @collection.getOps @docName, 0, (err, ops) ->
            throw Error(err) if err
            assert.equal ops.length, 2
            for op in ops
              assert op.m.ts >= start
              assert op.m.ts <= end
            done()

    it 'returns all ops if to is not defined', (done) -> @create =>
      @collection.getOps @docName, 0, (err, ops) =>
        throw new Error err if err
        assert.deepEqual stripTs(ops), [create:{type:otTypes.text.uri, data:''}, v:0, m:{}]

        @collection.submit @docName, v:1, op:['hi'], (err, v) =>
          @collection.getOps @docName, 0, (err, ops) ->
            throw new Error err if err
            assert.deepEqual stripTs(ops), [{create:{type:otTypes.text.uri, data:''}, v:0, m:{}}, {op:['hi'], v:1, m:{}}]
            done()

    it 'works if redis has no data', (done) -> @create =>
      @redis.flushdb =>
        @collection.getOps @docName, 0, (err, ops) =>
          throw new Error err if err
          assert.deepEqual stripTs(ops), [create:{type:otTypes.text.uri, data:''}, v:0, m:{}]
          done()

    it 'ignores redis operations if the version isnt set', (done) -> @create =>
      @redis.del "#{@cName}.#{@docName} v", (err, result) =>
        throw Error err if err
        # If the key format ever changes, this test should fail instead of becoming silently ineffective
        assert.equal result, 1

        @redis.lset "#{@cName}.#{@docName} ops", 0, "junk that will crash livedb", (err) =>

          @collection.getOps @docName, 0, (err, ops) =>
            throw new Error err if err
            assert.deepEqual stripTs(ops), [create:{type:otTypes.text.uri, data:''}, v:0, m:{}]
            done()

    it 'removes junk in the redis oplog on submit', (done) -> @create =>
      @redis.del "#{@cName}.#{@docName} v", (err, result) =>
        throw Error err if err
        # If the key format ever changes, this test should fail instead of becoming silently ineffective
        assert.equal result, 1

        @redis.lset "#{@cName}.#{@docName} ops", 0, "junk that will crash livedb", (err) =>

          @collection.submit @docName, v:1, op:['hi'], (err, v) =>
            throw new Error err if err

            @collection.getOps @docName, 0, (err, ops) =>
              throw new Error err if err
              assert.deepEqual stripTs(ops), [{create:{type:otTypes.text.uri, data:''}, v:0, m:{}}, {op:['hi'], v:1, m:{}}]
              done()

    describe 'does not hit the database if the version is current in redis', ->
      beforeEach (done) -> @create =>
        @db.getVersion = -> throw Error 'getVersion should not be called'
        @db.getOps = -> throw Error 'getOps should not be called'
        done()

      it 'from previous version', (done) ->
        # This one operation is in redis. It should be fetched.
        @collection.getOps @docName, 0, (err, ops) =>
          throw new Error err if err
          assert.strictEqual ops.length, 1
          done()

      it 'from current version', (done) ->
        # Redis knows that the document is at version 1, so we should return [] here.
        @collection.getOps @docName, 1, (err, ops) ->
          throw new Error err if err
          assert.deepEqual ops, []
          done()

    it 'caches the version in redis', (done) ->
      @create => @redis.flushdb =>
        @collection.getOps @docName, 0, (err, ops) =>
          throw new Error err if err

          @redis.get "#{@cName}.#{@docName} v", (err, result) ->
            throw new Error err if err
            assert.equal result, 1
            done()



    it 'errors if ops are missing from the snapshotdb and oplogs'

  describe 'bulkGetOpsSince', ->
    # This isn't really an external API, but there is a tricky edge case which
    # can come up that its hard to recreate using bulkSubscribe directly.
    it 'handles multiple gets which are missing from redis correctly', (done) -> # regression
      # Nothing in redis, but the data of two documents are in the database.
      @db.writeOp 'test', 'one', {v:0, create:{type:otTypes.text.uri}}, =>
      @db.writeOp 'test', 'two', {v:0, create:{type:otTypes.text.uri}}, =>

        @client.bulkGetOpsSince {test:{one:0, two:0}}, (err, result) ->
          throw Error err if err
          assert.deepEqual result,
            test:
              one: [{v:0, create:{type:otTypes.text.uri}}]
              two: [{v:0, create:{type:otTypes.text.uri}}]
            done()

  describe 'subscribe', ->
    for subType in ['single', 'bulk'] then do (subType) -> describe subType, ->
      beforeEach ->
        @subscribe = if subType is 'single'
          @collection.subscribe
        else
          (docName, v, callback) =>
            request = {}
            request[@cName] = {}
            request[@cName][docName] = v
            @client.bulkSubscribe request, (err, streams) =>
              callback err, if streams then streams[@cName]?[docName]

      it 'observes local changes', (done) -> @create =>
        @subscribe @docName, 1, (err, stream) =>
          throw new Error err if err

          stream.on 'data', (op) ->
            try
              assert.deepEqual stripTs(op), {v:1, op:['hi'], src:'abc', seq:123, m:{}}
              stream.destroy()
              done()
            catch e
              console.error e.stack
              throw e

          @collection.submit @docName, v:1, op:['hi'], src:'abc', seq:123

      it 'sees ops when you observe an old version', (done) -> @create =>
        # The document has version 1
        @subscribe @docName, 0, (err, stream) =>
            #stream.once 'readable', =>
            assert.deepEqual stripTs(stream.read()), {v:0, create:{type:otTypes.text.uri, data:''}, m:{}}
            # And we still get ops that come in now.
            @collection.submit @docName, v:1, op:['hi'], src:'abc', seq:123,
            stream.once 'readable', ->
              assert.deepEqual stripTs(stream.read()), {v:1, op:['hi'], src:'abc', seq:123, m:{}}
              stream.destroy()
              done()

      it 'can observe a document that doesnt exist yet', (done) ->
        @subscribe @docName, 0, (err, stream) =>
          stream.on 'readable', ->
            assert.deepEqual stripTs(stream.read()), {v:0, create:{type:otTypes.text.uri, data:''}, m:{}}
            stream.destroy()
            done()

          @create()

      it 'does not throw when you double stream.destroy', (done) ->
        @subscribe @docName, 1, (err, stream) =>
          stream.destroy()
          stream.destroy()
          done()

      it 'has no dangling listeners after subscribing and unsubscribing', (done) ->
        @subscribe @docName, 0, (err, stream) =>
          stream.destroy()

          redis = redisLib.createClient()
          # I want to count the number of subscribed channels. Redis 2.8 adds
          # the 'pubsub' command, which does this. However, I can't rely on
          # pubsub existing so I'll use a dodgy method.
          #redis.send_command 'pubsub', ['CHANNELS'], (err, channels) ->
          redis.publish "15 #{@cName}.#{@docName}", '{}', (err, numSubscribers) ->
            assert.equal numSubscribers, 0
            redis.quit()
            done()

    it 'does not throw when you double stream.destroy', (done) ->
      @collection.subscribe @docName, 1, (err, stream) =>
        stream.destroy()
        stream.destroy()
        done()


    it 'works with separate clients', (done) -> @create =>
      numClients = 10 # You can go way higher, but it gets slow.

      # We have to share the database here because these tests are written
      # against the memory API, which doesn't share data between instances.
      clients = (createClient @db for [0...numClients])

      for c, i in clients
        c.client.submit @cName, @docName, v:1, op:["client #{i} "], (err) ->
          throw new Error err if err

      @collection.subscribe @docName, 1, (err, stream) =>
        throw new Error err if err
        # We should get numClients ops on the stream, in order.
        seq = 1
        stream.on 'readable', tryRead = =>
          data = stream.read()
          return unless data
          #console.log 'read', data
          delete data.op
          assert.deepEqual stripTs(data), {v:seq, m:{}} #, op:{op:'ins', p:['x', -1]}}

          if seq is numClients
            #console.log 'destroy stream'
            stream.destroy()

            for c, i in clients
              c.redis.quit()
              c.db.close()
            done()

            # Uncomment to see the actually submitted data
            #@collection.fetch @docName, (err, {v, data}) =>
            #  console.log data
          else
            seq++

          tryRead()

  # Query-based tests currently disabled because memory backend has such a primitive query system.
  describe 'Query', ->

    beforeEach ->
      sinon.stub @db, 'queryNeedsPollMode', -> no
      #sinon.stub @db, 'query', (db, index, query, cb) -> cb()
      #sinon.stub @db, 'queryDoc', (db, index, cName, docName, query, cb) -> cb()

    afterEach ->
      @db.query.restore() if @db.query.restore
      @db.queryDoc.restore() if @db.queryDoc.restore
      @db.queryNeedsPollMode.restore() if @db.queryNeedsPollMode.restore

    # Do these tests with polling turned on and off.
    for poll in [false, true] then do (poll) -> describe "poll:#{poll}", ->
      opts = {poll:poll, pollDelay:0}

      it 'returns the error from the query', (done) ->
        sinon.stub @db, 'query', (db, index, query, options, cb) ->
          cb 'Something went wrong'

        @collection.query {}, opts, (err, emitter) =>
          assert.equal err, 'Something went wrong'
          done()

      it 'passes the right arguments to db.query', (done) ->
        sinon.spy @db, 'query'
        @collection.query {'x':5}, opts, (err, emitter) =>
          assert @db.query.calledWith @client, @cName, {'x':5}
          done()

      it 'returns a result it already applies to', (done) ->
        expected = [
          docName: @docName,
          data: {x:5},
          type: otTypes.json0.uri,
          v:1,
          c:@cName
        ]

        sinon.stub @db, 'query', (db, index, query, options, cb) ->
          cb null, expected
        @collection.query {'x':5}, opts, (err, emitter) =>
          assert.deepEqual emitter.data, expected
          emitter.destroy()
          done()

      it 'gets an empty result set when you query something with no results', (done) ->
        sinon.stub @db, 'query', (db, index, query, options, cb) ->
          cb null, []

        @collection.query {'xyz':123}, opts, (err, emitter) ->
          assert.deepEqual emitter.data, []
          emitter.on 'diff', -> throw new Error 'should not have added results'

          process.nextTick ->
            emitter.destroy()
            done()

      it 'adds an element when it matches', (done) ->
        result = c:@cName, docName:@docName, v:1, data:{x:5}, type:otTypes.json0.uri

        @collection.query {'x':5}, opts, (err, emitter) =>
          emitter.on 'diff', (diff) =>
            assert.deepEqual diff, [index: 0, values: [result], type: 'insert']
            emitter.destroy()
            done()

          sinon.stub @db, 'query', (db, index, query, options, cb) -> cb null, [result]
          sinon.stub @db, 'queryDoc', (db, index, cName, docName, query, cb) -> cb null, result

          @create {x:5}

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
          sinon.stub @db, 'query', (db, index, query, options, cb) -> cb null, []
          sinon.stub @db, 'queryDoc', (db, index, cName, docName, query, cb) -> cb()

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

    describe 'queryFetch', ->
      it 'query fetch with no results works', (done) ->
        sinon.stub @db, 'query', (db, index, query, options, cb) -> cb null, []

        @collection.queryFetch {'somekeythatdoesnotexist':1}, (err, results) ->
          throw new Error err if err
          assert.deepEqual results, []
          done()

      it 'query with some results returns those results', (done) ->
        result = docName:@docName, data:'qwertyuiop', type:otTypes.text.uri, v:1
        sinon.stub @db, 'query', (db, index, query, options, cb) -> cb null, [result]

        @collection.queryFetch {'_data':'qwertyuiop'}, (err, results) =>
          assert.deepEqual results, [result]
          done()

      it 'does the right thing with a backend that returns extra data', (done) ->
        result =
          results: [{docName:@docName, data:'qwertyuiop', type:otTypes.text.uri, v:1}]
          extra: 'Extra stuff'
        sinon.stub @db, 'query', (db, index, query, options, cb) -> cb null, result

        @collection.queryFetch {'_data':'qwertyuiop'}, (err, results, extra) =>
          assert.deepEqual results, result.results
          assert.deepEqual extra, result.extra
          done()


    describe 'selected collections', ->
      it 'asks the db to pick the interesting collections'

      # This test is flaky. Don't know why.
      it.skip 'gets operations submitted to any specified collection', (done) ->
        @testWrapper.subscribedChannels = (cName, query, opts) =>
          assert.strictEqual cName, 'internet'
          assert.deepEqual query, {x:5}
          assert.deepEqual opts, {sexy:true, backend:'test', pollDelay:0}
          [@cName, @cName2]

        @testWrapper.query = (livedb, cName, query, options, callback) ->
          assert.deepEqual query, {x:5}
          callback null, []

        sinon.spy @testWrapper, 'query'
        sinon.spy @db, 'query'

        @client.query 'internet', {x:5}, {sexy:true, backend:'test', pollDelay:0}, (err) =>
          throw Error err if err
          @client.submit @cName, @docName, {v:0, create:{type:otTypes.text.uri}}, (err) =>
            throw new Error err if err
            @client.submit @cName2, @docName, {v:0, create:{type:otTypes.text.uri}}, (err) =>
              throw new Error err if err
              @client.submit @cName3, @docName, {v:0, create:{type:otTypes.text.uri}}, (err) =>
                throw new Error err if err
                assert.equal @testWrapper.query.callCount, 3
                assert.equal @db.query.callCount, 0
                done()

      it 'calls submit on the extra collections', (done) ->
        @testWrapper.subscribedChannels = (cName, query, opts) => [@cName]
        @testWrapper.submit = (cName, docName, opData, opts, snapshot, db, cb) -> cb()

        sinon.spy @testWrapper, 'submit'

        @client.submit @cName, @docName, {v:0, create:{type:otTypes.text.uri}}, {backend: 'test'}, (err) =>
          assert.equal @testWrapper.submit.callCount, 1
          done()

      it 'can call publish'

    describe 'extra data', ->
      it 'gets extra data in the initial result set', (done) ->
        sinon.stub @db, 'query', (client, cName, query, options, callback) ->
          callback null, {results:[], extra:{x:5}}

        @client.query 'internet', {x:5}, (err, stream) =>
          assert.deepEqual stream.extra, {x:5}
          done()

      it 'gets updated extra data when the result set changes', (done) ->
        x = 1
        sinon.stub @db, 'query', (client, cName, query, options, callback) ->
          callback null, {results:[], extra:{x:x++}}

        @collection.query {x:5}, {poll:true}, (err, stream) =>
          assert.deepEqual stream.extra, {x:1}

          stream.on 'extra', (extra) ->
            assert.deepEqual extra, {x:2}
            done()

          @create()


    it 'turns poll mode off automatically if opts.poll is undefined', (done) ->
      @db.subscribedChannels = (index, query, opts) ->
        assert.deepEqual opts, {poll: false}
        [index]

      @collection.query {x:5}, {}, (err, stream) => done()

    it 'turns poll mode on automatically if opts.poll is undefined', (done) ->
      @db.queryNeedsPollMode = -> true
      @db.subscribedChannels = (index, query, opts) ->
        assert.deepEqual opts, {poll: true}
        [index]

      @collection.query {x:5}, {}, (err, stream) => done()

  it 'Fails to apply an operation to a document that was deleted and recreated'

  it 'correctly namespaces pubsub operations so other collections dont get confused'


