# This used to be the whole set of tests - now some of the ancillary parts of
# livedb have been pulled out. These tests should probably be split out into
# multiple files.

livedb = require '../lib'
assert = require 'assert'

textType = require('ot-text').type
{createClient, setup, teardown, stripOps} = require './util'


describe 'livedb', ->
  beforeEach setup

  beforeEach ->
    @cName = '_test'
    @cName2 = '_test2'
    @cName3 = '_test3'

  afterEach teardown

  describe 'submit', ->
    it 'creates a doc', (done) ->
      @client.submit @cName, @docName, {v:0, create:{type:'text'}}, (err) ->
        throw new Error err if err
        done()

    it 'allows create ops with a null version', (done) ->
      @client.submit @cName, @docName, {v:null, create:{type:'text'}}, (err) ->
        throw new Error err if err
        done()

    it 'errors if you dont specify a type', (done) ->
      @client.submit @cName, @docName, {v:0, create:{}}, (err) ->
        assert.ok err
        done()

    it 'can create a document', (done) ->
      @client.submit @cName, @docName, {v:0, create:{type:'text', m:{language:'en'}}}, (err, v) =>
        throw new Error err if err
        @client.fetch @cName, @docName, (err, {v}) =>
          throw new Error err if err
          assert.equal v, 1
          done()

    it 'recreates documents at a new version after being deleted', (done) ->
      @client.submit @cName, @docName, {create:{type:'text'}}, (err, v) =>
        throw new Error err if err
        assert.equal v, 0
        @client.submit @cName, @docName, {del:true}, (err, v) =>
          throw new Error err if err
          assert.equal v, 1
          @client.submit @cName, @docName, {create:{type:'text'}}, (err, v) =>
            throw new Error err if err
            assert.equal v, 2
            @client.fetch @cName, @docName, (err, {v}) =>
              throw new Error err if err
              assert.equal v, 3
              done()

    it 'can modify a document', (done) -> @create =>
      @client.submit @cName, @docName, v:1, op:['hi'], (err, v) =>
        throw new Error err if err
        @client.fetch @cName, @docName, (err, {v, data}) =>
          throw new Error err if err
          assert.deepEqual data, 'hi'
          done()

    it 'transforms operations', (done) -> @create =>
      @client.submit @cName, @docName, v:1, op:['a'], src:'abc', seq:123, (err, v, ops) =>
        throw new Error err if err
        assert.deepEqual ops, []
        @client.submit @cName, @docName, v:1, op:['b'], (err, v, ops) =>
          throw new Error err if err
          assert.deepEqual stripOps(ops), [{v:1, op:['a'], src:'abc', seq:123}]
          done()

    it 'allows ops with a null version', (done) -> @create =>
      @client.submit @cName, @docName, v:null, op:['hi'], (err, v) =>
        throw new Error err if err
        @client.fetch @cName, @docName, (err, {v, data}) =>
          throw new Error err if err
          assert.deepEqual data, 'hi'
          done()

    it 'removes a doc', (done) -> @create =>
      @client.submit @cName, @docName, v:1, del:true, (err, v) =>
        throw new Error err if err
        @client.fetch @cName, @docName, (err, data) =>
          throw new Error err if err
          assert.equal data.data, null
          assert.equal data.type, null
          done()

    it 'removes a doc and allows creation of a new one', (done) ->
      @client.submit @cName, @docName, {create: {type: 'text', data: 'world'}}, (err) =>
        throw new Error err if err
        @client.submit @cName, @docName, v:1, del:true, (err, v) =>
          throw new Error err if err
          @client.fetch @cName, @docName, (err, data) =>
            throw new Error err if err
            assert.equal data.data, null
            assert.equal data.type, null
            @client.submit @cName, @docName, {create: {type: 'text', data: 'hello'}}, (err) =>
              throw new Error err if err
              @client.fetch @cName, @docName, (err, data) =>
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

      @client.submit @cName, @docName, v:1, src:'abc', seq:1, op:['client 1'], callback
      @client.submit @cName, @docName, v:1, src:'def', seq:1, op:['client 2'], callback

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
        assert.deepEqual stripOps(opData), {v:0, create:{type:textType.uri, data:''}, src:''}
        assert.deepEqual stripOps(snapshot), {v:1, data:'', type:textType.uri}
        done()

      @create()

    describe 'pre validate', ->
      it 'runs a supplied pre validate function on the data', (done) ->
        validationRun = no
        preValidate = (opData, snapshot) ->
          assert.deepEqual snapshot, {v:0}
          validationRun = yes
          return

        @client.submit @cName, @docName, {v:0, create:{type:'text'}, preValidate}, (err) ->
          assert.ok validationRun
          done()

      it 'does not submit if pre validation fails', (done) -> @create =>
        preValidate = (opData, snapshot) ->
          assert.deepEqual opData.op, ['hi']
          return 'no you!'

        @client.submit @cName, @docName, {v:1, op:['hi'], preValidate}, (err) =>
          assert.equal err, 'no you!'

          @client.fetch @cName, @docName, (err, {v, data}) =>
            throw new Error err if err
            assert.deepEqual data, ''
            done()

      it 'calls prevalidate on each component in turn, and applies them incrementally'


    describe 'validate', ->
      it 'runs a supplied validation function on the data', (done) ->
        validationRun = no
        validate = (opData, snapshot, callback) ->
          assert.deepEqual stripOps(snapshot), {v:1, data:'', type:textType.uri}
          validationRun = yes
          return

        @client.submit @cName, @docName, {v:0, create:{type:'text'}, validate}, (err) ->
          assert.ok validationRun
          done()

      it 'does not submit if validation fails', (done) -> @create =>
        validate = (opData, snapshot, callback) ->
          assert.deepEqual opData.op, ['hi']
          return 'no you!'

        @client.submit @cName, @docName, {v:1, op:['hi'], validate}, (err) =>
          assert.equal err, 'no you!'

          @client.fetch @cName, @docName, (err, {v, data}) =>
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
          assert.deepEqual stripOps(snapshot), {v:1, data:'', type:textType.uri}
          return {a:5}

        @client.getDirtyData = (c, d, op_, snapshot) =>
          assert.equal c, @cName
          assert.equal d, @docName
          assert.deepEqual op_, op
          assert.deepEqual stripOps(snapshot), {v:2, data:'hi', type:textType.uri}
          return {b:6}

        @client.submit @cName, @docName, op, (err) =>
          throw Error err if err

          @checkConsume 'a', [5], =>
            @checkConsume 'b', [6], done

  describe 'fetch', ->
    it 'can fetch created documents', (done) -> @create 'hi', =>
      @client.fetch @cName, @docName, (err, {v, data}) ->
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
        expected[@cName][@docName] = {data:'hi', v:1, type:textType.uri, docName:@docName}
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
        expected[@cName][@docName] = {data:'hi', v:1, type:textType.uri, docName:@docName}

        assert.deepEqual data, expected
        done()


  describe 'getOps', ->
    it 'returns an empty list for nonexistant documents', (done) ->
      @client.getOps @cName, @docName, 0, -1, (err, ops) ->
        throw new Error err if err
        assert.deepEqual ops, []
        done()

    it 'returns ops that have been submitted to a document', (done) -> @create =>
      @client.submit @cName, @docName, v:1, op:['hi'], (err, v) =>
        @client.getOps @cName, @docName, 0, 1, (err, ops) =>
          throw new Error err if err
          assert.deepEqual stripOps(ops), [create:{type:textType.uri, data:''}, v:0, src:'']

          @client.getOps @cName, @docName, 1, 2, (err, ops) ->
            throw new Error err if err
            assert.deepEqual stripOps(ops), [op:['hi'], v:1, src:'']
            done()

    it 'puts a decent timestamp in ops', (done) ->
      # TS should be between start and end.
      start = Date.now()
      op1 = {v:0, create:{type:'text'}}
      op2 = {v:1, op:['hi there'], m:{ts:123}}
      @client.submit @cName, @docName, op1, (err) =>
        throw Error(err) if err
        @client.submit @cName, @docName, op2, (err) =>
          throw Error(err) if err
          end = Date.now()
          assert op1.m.ts >= start
          assert op1.m.ts <= end
          assert op2.m.ts >= start
          assert op2.m.ts <= end
          done()

    it 'returns all ops if to is not defined', (done) -> @create =>
      @client.getOps @cName, @docName, 0, (err, ops) =>
        throw new Error err if err
        assert.deepEqual stripOps(ops), [create:{type:textType.uri, data:''}, v:0, src:'']

        @client.submit @cName, @docName, v:1, op:['hi'], (err, v) =>
          @client.getOps @cName, @docName, 0, (err, ops) ->
            throw new Error err if err
            assert.deepEqual stripOps(ops), [{create:{type:textType.uri, data:''}, v:0, src:''}, {op:['hi'], v:1, src:''}]
            done()

    it 'errors if ops are missing from the db and oplogs'

    it 'works with separate clients', (done) -> @create =>
      return done() unless @driver.distributed

      numClients = 10 # You can go way higher, but it gets slow.

      # We have to share the database here because these tests are written
      # against the memory API, which doesn't share data between instances.
      clients = (createClient @db for [0...numClients])

      for c, i in clients
        c.client.submit @cName, @docName, v:1, op:["client #{i} "], (err) ->
          throw new Error err if err

      @client.subscribe @cName, @docName, 1, (err, stream) =>
        throw new Error err if err
        # We should get numClients ops on the stream, in order.
        seq = 1
        stream.on 'readable', tryRead = =>
          data = stream.read()
          return unless data
          #console.log 'read', data
          delete data.op
          assert.deepEqual stripOps(data), {v:seq} #, op:{op:'ins', p:['x', -1]}}

          if seq is numClients
            #console.log 'destroy stream'
            stream.destroy()

            for c, i in clients
              c.redis.quit()
              c.db.close()
            done()

            # Uncomment to see the actually submitted data
            #@client.fetch @cName, @docName, (err, {v, data}) =>
            #  console.log data
          else
            seq++

          tryRead()

  it 'Fails to apply an operation to a document that was deleted and recreated'


