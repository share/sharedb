assert = require 'assert'
sinon = require 'sinon'
json0 = require('ot-json0').type
text = require('ot-text').type

{createClient, createDoc, setup, teardown} = require './util'

describe 'operation propagation granularity', ->
  beforeEach setup
  beforeEach ->
    @cName = '_test'

  beforeEach ->
    sinon.stub @db, 'queryNeedsPollMode', -> no

  afterEach teardown
  afterEach ->
    @db.queryPoll.restore() if @db.queryPoll.restore
    @db.queryPollDoc.restore() if @db.queryPollDoc.restore
    @db.queryNeedsPollMode.restore() if @db.queryNeedsPollMode.restore

  # Do these tests with polling turned on and off.
  for poll in [false, true] then do (poll) -> describe "poll:#{poll}", ->
    beforeEach ->
      @client.suppressCollectionPublish = true

    it 'throttles publishing operations when suppressCollectionPublish === true', (done) ->
      result = docName:@docName, v:1, data:{x:5}, type:json0.uri

      @client.querySubscribe @cName, {'x':5}, {poll:poll, pollDelay:0}, (err, emitter) =>
        emitter.onDiff = (diff) =>
          throw new Error 'should not propagate operation to query'

        sinon.stub @db, 'queryPoll', (cName, query, options, cb) => cb null, [@docName]
        sinon.stub @db, 'queryPollDoc', (cName, docName, query, options, cb) => cb null, true

        @create {x:5}, () -> done()

  # Do these tests with polling turned on and off.
  for poll in [false, true] then do (poll) -> describe "poll:#{poll}", ->
    beforeEach ->
      @client.suppressCollectionPublish = false

    it 'does not throttle publishing operations with suppressCollectionPublish === false', (done) ->
      result = docName:@docName, v:1, data:{x:5}, type:json0.uri

      @client.querySubscribe @cName, {'x':5}, {poll:poll, pollDelay:0}, (err, emitter) =>
        emitter.onDiff = (diff) =>
          assert.deepEqual diff, [index: 0, values: [result]]
          emitter.destroy()
          done()

        sinon.stub @db, 'queryPoll', (cName, query, options, cb) => cb null, [@docName]
        sinon.stub @db, 'queryPollDoc', (cName, docName, query, options, cb) => cb null, true

        @create {x:5}
