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

  afterEach teardown
  afterEach ->
    @db.query.restore() if @db.query.restore
    @db.queryPoll.restore() if @db.queryPoll.restore
    @db.queryPollDoc.restore() if @db.queryPollDoc.restore
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

      @client.querySubscribe @cName, {}, opts, (err, emitter) =>
        assert.equal err, 'Something went wrong'
        done()

    it 'returns a result it already applies to', (done) ->
      expected = [
        docName: @docName,
        data: {x:5},
        type: json0.uri,
        v:1
      ]

      sinon.stub @db, 'query', (db, index, query, options, cb) ->
        cb null, expected
      @client.querySubscribe @cName, {'x':5}, opts, (err, emitter, results) =>
        assert.deepEqual results, expected
        emitter.destroy()
        done()

    it 'gets an empty result set when you query something with no results', (done) ->
      sinon.stub @db, 'query', (db, index, query, options, cb) ->
        cb null, []

      @client.querySubscribe @cName, {'xyz':123}, opts, (err, emitter, results) ->
        assert.deepEqual results, []
        emitter.onDiff = -> throw new Error 'should not have added results'

        process.nextTick ->
          emitter.destroy()
          done()

    it 'adds an element when it matches', (done) ->
      result = docName:@docName, v:1, data:{x:5}, type:json0.uri

      @client.querySubscribe @cName, {'x':5}, opts, (err, emitter) =>
        emitter.onDiff = (diff) =>
          assert.deepEqual diff, [index: 0, values: [result]]
          emitter.destroy()
          done()

        sinon.stub @db, 'queryPoll', (cName, query, options, cb) => cb null, [@docName]
        sinon.stub @db, 'queryPollDoc', (cName, docName, query, options, cb) => cb null, true

        @create {x:5}

    it 'remove an element that no longer matches', (done) -> @create {x:5}, =>
      @client.querySubscribe @cName, {'x':5}, opts, (err, emitter) =>
        emitter.onDiff = (diff) =>
          assert.deepEqual diff, [index:0, howMany:1]
          emitter.destroy()
          done()

        op = op:'rm', p:[]
        sinon.stub @db, 'queryPoll', (cName, query, options, cb) => cb null, []
        sinon.stub @db, 'queryPollDoc', (cName, docName, query, options, cb) => cb null, false

        @client.submit @cName, @docName, v:1, op:[{p:['x'], od:5, oi:6}], (err, v) =>

    it 'removes deleted elements', (done) -> @create {x:5}, =>
      @client.querySubscribe @cName, {'x':5}, opts, (err, emitter, results) =>
        assert.strictEqual results.length, 1

        emitter.onDiff = (diff) =>
          assert.deepEqual diff, [index:0, howMany:1]
          emitter.destroy()
          done()

        @client.submit @cName, @docName, v:1, del:true, (err, v) =>
          throw new Error err if err

    it 'does not emit receive events to a destroyed query', (done) ->
      @client.querySubscribe @cName, {'x':5}, opts, (err, emitter) =>
        emitter.onDiff = -> throw new Error 'add called after destroy'

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

      @client.querySubscribe @cName, {'x':5}, opts, (err, emitter) =>
        throw Error err if err

        @db.queryPoll = -> throw Error 'query should not be called'
        @db.queryPollDoc = -> throw Error 'queryDoc should not be called'

        @client.submit @cName, @docName, v:1, op:[{p:['x'], na:1}], (err, v) =>
          assert.equal called, 1
          done()

    it 'does not poll if db.queryShouldPoll returns false', (done) -> @create {x:5}, =>
      called = 0
      @db.queryShouldPoll = (cName, docName, data, index, query) =>
        assert.equal cName, @cName
        assert.equal docName, @docName
        assert.deepEqual query, {x:5}
        called++
        no

      @client.querySubscribe @cName, {x:5}, opts, (err, emitter) =>
        throw Error err if err

        @db.queryPoll = -> throw Error 'query should not be called'
        @db.queryPollDoc = -> throw Error 'queryDoc should not be called'

        @client.submit @cName, @docName, v:1, op:[{p:['x'], na:1}], (err, v) =>
          assert.equal called, 1
          done()

  describe 'queryFetch', ->
    it 'query fetch with no results works', (done) ->
      sinon.stub @db, 'query', (cName, query, fields, options, cb) -> cb null, []

      @client.queryFetch @cName, {'somekeythatdoesnotexist':1}, (err, results) ->
        throw new Error err if err
        assert.deepEqual results, []
        done()

    it 'query with some results returns those results', (done) ->
      result = docName:@docName, data:'qwertyuiop', type:text.uri, v:1
      sinon.stub @db, 'query', (cName, query, fields, options, cb) -> cb null, [result]

      @client.queryFetch @cName, {'_data':'qwertyuiop'}, (err, results) =>
        assert.deepEqual results, [result]
        done()

    it 'passes through extra data from backend', (done) ->
      expectedResults = [{docName:@docName, data:'qwertyuiop', type:text.uri, v:1}]
      expectedExtra = 'Extra stuff'
      sinon.stub @db, 'query', (cName, query, fields, options, cb) -> cb null, expectedResults, expectedExtra

      @client.queryFetch @cName, {'_data':'qwertyuiop'}, (err, results, extra) =>
        assert.deepEqual results, expectedResults
        assert.deepEqual extra, expectedExtra
        done()


  describe 'selected collections', ->
    it 'asks the db to pick the interesting collections'

    # This test is flaky. Don't know why.
    it.skip 'gets operations submitted to any specified collection', (done) ->
      @testWrapper.query = (cName, query, fields, options, callback) ->
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
      @testWrapper.submit = (cName, docName, opData, opts, snapshot, db, cb) -> cb()

      sinon.spy @testWrapper, 'submit'

      @client.submit @cName, @docName, {v:0, create:{type:text.uri}}, {backend: 'test'}, (err) =>
        assert.equal @testWrapper.submit.callCount, 1
        done()

    it 'can call publish'

  describe 'extra data', ->
    it 'gets extra data in the initial result set', (done) ->
      sinon.stub @db, 'query', (cName, query, fields, options, callback) ->
        callback null, [], {x:5}

      @client.querySubscribe 'internet', {x:5}, (err, emitter, results, extra) =>
        assert.deepEqual extra, {x:5}
        done()

    it 'gets updated extra data when the result set changes', (done) ->
      sinon.stub @db, 'query', (cName, query, fields, options, callback) ->
        callback null, [], {x:1}
      sinon.stub @db, 'queryPoll', (cName, query, options, callback) ->
        callback null, [], {x:2}

      @client.querySubscribe @cName, {x:5}, {poll:true}, (err, emitter, results, extra) =>
        assert.deepEqual extra, {x:1}

        emitter.onExtra = (extra) ->
          assert.deepEqual extra, {x:2}
          done()

        @create()
