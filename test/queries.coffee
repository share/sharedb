assert = require 'assert'
sinon = require 'sinon'
json0 = require('ot-json0').type
text = require('ot-text').type

{createClient, createDoc, setup, teardown} = require './util'

# Query-based tests currently disabled because memory backend has such a primitive query system.
describe 'queries', ->
  beforeEach setup
  beforeEach ->
    @cName = '_test'
    @cName2 = '_test2'
    @cName3 = '_test3'

  beforeEach ->
    sinon.stub @db, 'queryNeedsPollMode', -> no
    #sinon.stub @db, 'query', (db, index, query, cb) -> cb()
    #sinon.stub @db, 'queryDoc', (db, index, cName, docName, query, cb) -> cb()

  afterEach teardown
  afterEach ->
    @db.query.restore() if @db.query.restore
    @db.queryDoc.restore() if @db.queryDoc.restore
    @db.queryNeedsPollMode.restore() if @db.queryNeedsPollMode.restore

  # Do these tests with polling turned on and off.
  for poll in [false, true] then do (poll) -> describe "poll:#{poll}", ->
  # for poll in [false] then do (poll) -> describe "poll:#{poll}", ->
    opts = null
    beforeEach ->
      opts = {poll:poll, pollDelay:0}

    it 'returns the error from the query', (done) ->
      sinon.stub @db, 'query', (db, index, query, options, cb) ->
        cb 'Something went wrong'

      @collection.queryPoll {}, opts, (err, emitter) =>
        assert.equal err, 'Something went wrong'
        done()

    it 'passes the right arguments to db.query', (done) ->
      sinon.spy @db, 'query'
      @collection.queryPoll {'x':5}, opts, (err, emitter) =>
        assert @db.query.calledWith @client, @cName, {'x':5}
        done()

    it 'returns a result it already applies to', (done) ->
      expected = [
        docName: @docName,
        data: {x:5},
        type: json0.uri,
        v:1,
        c:@cName
      ]

      sinon.stub @db, 'query', (db, index, query, options, cb) ->
        cb null, expected
      @collection.queryPoll {'x':5}, opts, (err, emitter) =>
        assert.deepEqual emitter.data, expected
        emitter.destroy()
        done()

    it 'gets an empty result set when you query something with no results', (done) ->
      sinon.stub @db, 'query', (db, index, query, options, cb) ->
        cb null, []

      @collection.queryPoll {'xyz':123}, opts, (err, emitter) ->
        assert.deepEqual emitter.data, []
        emitter.on 'diff', -> throw new Error 'should not have added results'

        process.nextTick ->
          emitter.destroy()
          done()

    it 'adds an element when it matches', (done) ->
      result = c:@cName, docName:@docName, v:1, data:{x:5}, type:json0.uri

      @collection.queryPoll {'x':5}, opts, (err, emitter) =>
        emitter.on 'diff', (diff) =>
          assert.deepEqual diff, [index: 0, values: [result], type: 'insert']
          emitter.destroy()
          done()

        sinon.stub @db, 'query', (db, index, query, options, cb) -> cb null, [result]
        sinon.stub @db, 'queryDoc', (db, index, cName, docName, query, cb) -> cb null, result

        @create {x:5}

    it 'remove an element that no longer matches', (done) -> @create {x:5}, =>
      @collection.queryPoll {'x':5}, opts, (err, emitter) =>
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
        sinon.stub @db, 'queryDoc', (db, index, cName, docName, query, cb) ->
          cb null, false

        @collection.submit @docName, v:1, op:[{p:['x'], od:5, oi:6}], (err, v) =>

    it 'removes deleted elements', (done) -> @create {x:5}, =>
      @collection.queryPoll {'x':5}, opts, (err, emitter) =>
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
      @collection.queryPoll {'x':5}, opts, (err, emitter) =>
        emitter.on 'diff', -> throw new Error 'add called after destroy'

        emitter.destroy()

        # Sooo tasty. emitter... you know you want this delicious document.
        @create {x:5}, ->
          setTimeout (-> done()), 20

    it 'works if you remove then re-add a document from a query' # Regression.

    it 'does not poll if opts.shouldPoll returns false', (done) -> @create {x:5}, =>
      called = 0
      opts.shouldPoll = (cName, docName, data, index, query) =>
        assert.equal cName, @cName
        assert.equal docName, @docName
        assert.deepEqual query, {x:5}
        called++
        no

      @collection.queryPoll {'x':5}, opts, (err, emitter) =>
        throw Error err if err

        @db.query = -> throw Error 'query should not be called'
        @db.queryDoc = -> throw Error 'queryDoc should not be called'

        @collection.submit @docName, v:1, op:[{p:['x'], na:1}], (err, v) =>
          assert.equal called, 1
          done()

    it 'does not poll if db.shouldPoll returns false', (done) -> @create {x:5}, =>
      called = 0
      @db.queryShouldPoll = (livedb, cName, docName, data, index, query) =>
        assert.equal cName, @cName
        assert.equal docName, @docName
        assert.deepEqual query, {x:5}
        called++
        console.log(cName, docName, data, index, query);
        console.log(data.op)
        no

      @collection.queryPoll {x:5}, opts, (err, emitter) =>
        throw Error err if err

        @db.query = -> throw Error 'query should not be called'
        @db.queryDoc = -> throw Error 'queryDoc should not be called'

        @collection.submit @docName, v:1, op:[{p:['x'], na:1}], (err, v) =>
          assert.equal called, 1
          done()

  describe 'queryFetch', ->
    it 'query fetch with no results works', (done) ->
      sinon.stub @db, 'query', (db, index, query, options, cb) -> cb null, []

      @collection.queryFetch {'somekeythatdoesnotexist':1}, (err, results) ->
        throw new Error err if err
        assert.deepEqual results, []
        done()

    it 'query with some results returns those results', (done) ->
      result = docName:@docName, data:'qwertyuiop', type:text.uri, v:1
      sinon.stub @db, 'query', (db, index, query, options, cb) -> cb null, [result]

      @collection.queryFetch {'_data':'qwertyuiop'}, (err, results) =>
        assert.deepEqual results, [result]
        done()

    it 'does the right thing with a backend that returns extra data', (done) ->
      result =
        results: [{docName:@docName, data:'qwertyuiop', type:text.uri, v:1}]
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
        @client.submit @cName, @docName, {v:0, create:{type:text.uri}}, (err) =>
          throw new Error err if err
          @client.submit @cName2, @docName, {v:0, create:{type:text.uri}}, (err) =>
            throw new Error err if err
            @client.submit @cName3, @docName, {v:0, create:{type:text.uri}}, (err) =>
              throw new Error err if err
              assert.equal @testWrapper.query.callCount, 3
              assert.equal @db.query.callCount, 0
              done()

    it 'calls submit on the extra collections', (done) ->
      @testWrapper.subscribedChannels = (cName, query, opts) => [@cName]
      @testWrapper.submit = (cName, docName, opData, opts, snapshot, db, cb) -> cb()

      sinon.spy @testWrapper, 'submit'

      @client.submit @cName, @docName, {v:0, create:{type:text.uri}}, {backend: 'test'}, (err) =>
        assert.equal @testWrapper.submit.callCount, 1
        done()

    it 'can call publish'

  describe 'extra data', ->
    it 'gets extra data in the initial result set', (done) ->
      sinon.stub @db, 'query', (client, cName, query, options, callback) ->
        callback null, {results:[], extra:{x:5}}

      @client.queryPoll 'internet', {x:5}, (err, stream) =>
        assert.deepEqual stream.extra, {x:5}
        done()

    it 'gets updated extra data when the result set changes', (done) ->
      x = 1
      sinon.stub @db, 'query', (client, cName, query, options, callback) ->
        callback null, {results:[], extra:{x:x++}}

      @collection.queryPoll {x:5}, {poll:true}, (err, stream) =>
        assert.deepEqual stream.extra, {x:1}

        stream.on 'extra', (extra) ->
          assert.deepEqual extra, {x:2}
          done()

        @create()


  it 'turns poll mode off automatically if opts.poll is undefined', (done) ->
    @db.subscribedChannels = (index, query, opts) ->
      assert.deepEqual opts, {poll: false}
      [index]

    @collection.queryPoll {x:5}, {}, (err, stream) => done()

  it 'turns poll mode on automatically if opts.poll is undefined', (done) ->
    @db.queryNeedsPollMode = -> true
    @db.subscribedChannels = (index, query, opts) ->
      assert.deepEqual opts, {poll: true}
      [index]

    @collection.queryPoll {x:5}, {}, (err, stream) => done()
