redisDriver = require '../lib/redisdriver'
redisLib = require 'redis'
Memory = require '../lib/memory'
assert = require 'assert'
sinon = require 'sinon'
json0 = require('ot-json0').type
text = require('ot-text').type

{createClient, createDoc, setup, teardown} = require './util'

createRedisDriver = (oplog) ->
  redis = redisLib.createClient()
  redis.select redis.selected_db = 15
  return redisDriver oplog, redis

parsePublishArgs = (args) ->
  cName: args[0]
  opData: args[1]
  snapshot: args[2]

# TODO noansknv Cleanup and maybe factor out redis creation and cleanup? Look at redisdriver.coffee
# TODO noansknv Also it would be nice to run the test the same way driver tests are run - against both
#      drivers.
describe 'operation propagation granularity', ->
  beforeEach (done) ->
    c = redisLib.createClient()
    c.select 15
    c.flushdb (err) ->
      throw Error err if err
      c.quit()
      done()

  describe 'Propagates changes to appropriate channels', ->
    beforeEach -> setup.call(this, new Memory(), createRedisDriver, 'A')

    beforeEach ->
      @client.getPublishChannels = (cName, opData, snapshot) ->
        return [cName, cName + ' postfix']

    afterEach teardown

    it 'calls getPublishChannels before propagating changes', (done) ->
      sinon.spy @client, 'getPublishChannels'
      @create {x:5}, () =>
        assert.ok @client.getPublishChannels.calledOnce
        args = parsePublishArgs(@client.getPublishChannels.getCall(0).args)
        assert.equal args.cName, @cName
        assert.deepEqual args.snapshot.data, {x:5}
        done()

    it 'propagates changes to all expected channels', (done) ->
      subscribe = ['A', 'A postfix']
      @client.driver.subscribeChannels subscribe, (err, stream) ->
        channels = []

        stream.on 'readable', () ->
          while (data = stream.read())
            channels.push data.channel

            if channels.length == subscribe.length
              assert.deepEqual channels, subscribe
              done()

      @create {x:5}

    it 'propagates changes to projected queries', (done) ->
      @client.addProjection 'B', 'A', 'json0', {x:true}
      result = c:'B', docName:@docName, v:1, data:{x:5}, type:json0.uri

      @client.queryPoll 'B', {'x':5}, {poll:true, pollDelay:0}, (err, emitter) =>
        emitter.on 'diff', (diff) =>
          assert.deepEqual diff, [index: 0, values: [result], type: 'insert']
          emitter.destroy()
          done()

        @create {x:5}

    it 'propagates changes to projected queries with channelPostfix', (done) ->
      # Project A as B
      @client.addProjection 'B', 'A', 'json0', {x:true}
      # Publish only on postfixed A
      @client.getPublishChannels = (cName, opData, snapshot) ->
        return ['A postfix']

      result = c:'B', docName:@docName, v:1, data:{x:5}, type:json0.uri

      # Query postfixed B, which should be translated into postfixed A
      @client.queryPoll 'B', {'x':5}, {poll:true, pollDelay:0, channelPostfix: 'postfix'}, (err, emitter) =>
        emitter.on 'diff', (diff) =>
          assert.deepEqual diff, [index: 0, values: [result], type: 'insert']
          emitter.destroy()
          done()

        @create {x:5}

  describe 'Propagation throttling', () ->
    beforeEach -> setup.call(this, new Memory(), createRedisDriver)

    afterEach ->
      @db.query.restore() if @db.query.restore
      @db.queryDoc.restore() if @db.queryDoc.restore
      @db.queryNeedsPollMode.restore() if @db.queryNeedsPollMode.restore

    afterEach teardown

    beforeEach ->
      sinon.stub @db, 'queryNeedsPollMode', -> no

    # Do these tests with polling turned on and off.
    for poll in [false, true] then do (poll) -> describe "poll:#{poll}", ->
      beforeEach ->
        @client.suppressCollectionPublish = true

      it 'throttles publishing operations when suppressCollectionPublish === true', (done) ->
        result = c:@cName, docName:@docName, v:1, data:{x:5}, type:json0.uri

        @collection.queryPoll {'x':5}, {poll:poll, pollDelay:0}, (err, emitter) =>
          emitter.on 'diff', (diff) =>
            throw new Error 'should not propagate operation to query'

          sinon.stub @db, 'query', (db, index, query, options, cb) -> cb null, [result]
          sinon.stub @db, 'queryDoc', (db, index, cName, docName, query, cb) -> cb null, result

          @create {x:5}, () -> done()

    # Do these tests with polling turned on and off.
    for poll in [false, true] then do (poll) -> describe "poll:#{poll}", ->
      beforeEach ->
        @client.suppressCollectionPublish = false

      it 'does not throttle publishing operations with suppressCollectionPublish === false', (done) ->
        result = c:@cName, docName:@docName, v:1, data:{x:5}, type:json0.uri

        @collection.queryPoll {'x':5}, {poll:poll, pollDelay:0}, (err, emitter) =>
          emitter.on 'diff', (diff) =>
            assert.deepEqual diff, [index: 0, values: [result], type: 'insert']
            emitter.destroy()
            done()

          sinon.stub @db, 'query', (db, index, query, options, cb) -> cb null, [result]
          sinon.stub @db, 'queryDoc', (db, index, cName, docName, query, cb) -> cb null, result

          @create {x:5}
