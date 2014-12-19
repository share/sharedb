# This used to be the whole set of tests - now some of the ancillary parts of
# livedb have been pulled out. These tests should probably be split out into
# multiple files.

livedb = require '../lib'
assert = require 'assert'

textType = require('ot-text').type
{createClient, setup, teardown, stripTs} = require './util'

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
  beforeEach setup

  beforeEach ->
    @cName = '_test'
    @cName2 = '_test2'
    @cName3 = '_test3'

  afterEach teardown

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

    it 'can create a document with metadata', (done) ->
      @collection.submit @docName, {v:0, create:{type:'text', m:{language:'en'}}}, (err, v) =>
        throw new Error err if err
        @collection.fetch @docName, (err, {v, m}) =>
          throw new Error err if err
          assert.equal m.language, 'en'
          done()

    it 'removes metadata when documents are recreated', (done) ->
      @collection.submit @docName, {create:{type:'text', m:{language:'en'}}}, (err, v) =>
        throw new Error err if err
        @collection.submit @docName, {del:true}, (err, v) =>
          throw new Error err if err
          @collection.submit @docName, {create:{type:'text'}}, (err, v) =>
            throw new Error err if err
            @collection.fetch @docName, (err, {v, m}) =>
              throw new Error err if err
              assert.equal m.language, null
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

    it 'removes a doc and allows creation of a new one', (done) ->
      @collection.submit @docName, {create: {type: 'text', data: 'world'}}, (err) =>
        throw new Error err if err
        @collection.submit @docName, v:1, del:true, (err, v) =>
          throw new Error err if err
          @collection.fetch @docName, (err, data) =>
            throw new Error err if err
            assert.equal data.data, null
            assert.equal data.type, null
            @collection.submit @docName, {create: {type: 'text', data: 'hello'}}, (err) =>
              throw new Error err if err
              @collection.fetch @docName, (err, data) =>
                throw new Error err if err
                assert.equal data.data, 'hello'
                assert.equal data.type, 'http://sharejs.org/types/textv1'
                done()

    it 'passes an error back to fetch if fetching returns a document with no version'

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

    it 'sends operations to any extra db backends', (done) ->
      @testWrapper.submit = (cName, docName, opData, options, snapshot, callback) =>
        assert.equal cName, @cName
        assert.equal docName, @docName
        assert.deepEqual stripTs(opData), {v:0, create:{type:textType.uri, data:''}, m:{}, src:''}
        checkAndStripMetadata snapshot
        assert.deepEqual snapshot, {v:1, data:'', type:textType.uri, m:{}}
        done()

      @create()

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
          assert.deepEqual snapshot, {v:1, data:'', type:textType.uri, m:{}}
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

    describe 'dirty data', ->
      beforeEach ->
        @checkConsume = (list, expected, options, callback) =>
          # Stolen from driver tests.
          [options, callback] = [{}, options] if typeof options is 'function'
          called = false
          consume = (data, callback) ->
            assert !called
            called = true
            assert.deepEqual data, expected
            callback()

          @client.consumeDirtyData list, options, consume, (err) ->
            throw Error err if err
            assert.equal called, expected isnt null
            callback()

      it 'calls getDirtyDataPre and getDirtyData', (done) -> @create =>
        op = {v:1, op:['hi']}

        @client.getDirtyDataPre = (c, d, op_, snapshot) =>
          assert.equal c, @cName
          assert.equal d, @docName
          assert.deepEqual op_, op
          # Editing the snapshot here is a little naughty.
          checkAndStripMetadata snapshot
          assert.deepEqual snapshot, {v:1, data:'', type:textType.uri, m:{}}
          return {a:5}

        @client.getDirtyData = (c, d, op_, snapshot) =>
          assert.equal c, @cName
          assert.equal d, @docName
          assert.deepEqual op_, op
          # Editing the snapshot here is a little naughty.
          checkAndStripMetadata snapshot
          assert.deepEqual snapshot, {v:2, data:'hi', type:textType.uri, m:{}}
          return {b:6}

        @collection.submit @docName, op, (err) =>
          throw Error err if err

          @checkConsume 'a', [5], =>
            @checkConsume 'b', [6], done

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
        expected[@cName][@docName] = {data:'hi', v:1, type:textType.uri, m:{}}

        for cName, docs of data
          for docName, snapshot of docs
            checkAndStripMetadata snapshot

        assert.deepEqual data, expected
        done()

    it 'can bulk fetch a projected document and actual document at the same time'

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
        expected[@cName][@docName] = {data:'hi', v:1, type:textType.uri, m:{}}

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
          assert.deepEqual stripTs(ops), [create:{type:textType.uri, data:''}, v:0, m:{}, src:'']

          @collection.getOps @docName, 1, 2, (err, ops) ->
            throw new Error err if err
            assert.deepEqual stripTs(ops), [op:['hi'], v:1, m:{}, src:'']
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
        assert.deepEqual stripTs(ops), [create:{type:textType.uri, data:''}, v:0, m:{}, src:'']

        @collection.submit @docName, v:1, op:['hi'], (err, v) =>
          @collection.getOps @docName, 0, (err, ops) ->
            throw new Error err if err
            assert.deepEqual stripTs(ops), [{create:{type:textType.uri, data:''}, v:0, m:{}, src:''}, {op:['hi'], v:1, m:{}, src:''}]
            done()



    it 'errors if ops are missing from the snapshotdb and oplogs'



    it 'works with separate clients', (done) -> @create =>
      return done() unless @driver.distributed

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

  it 'Fails to apply an operation to a document that was deleted and recreated'


