# This fires the tests for the redis driver
redisLib = require 'redis'
assert = require 'assert'

runTests = require './driver'

describe 'redis driver', ->
  # redisLib.createClient().eval """redis.log(redis.LOG_WARNING, '--------------')""", 0, ->
  create = (oplog) ->
    createDriver = require '../lib/redisdriver'
    redis = redisLib.createClient()
    redis.select redis.selected_db = 15
    return createDriver oplog, redis

  destroy = (driver) ->
    driver.destroy()
    driver.redis.quit()

  beforeEach (done) ->
    c = redisLib.createClient()
    c.select 15
    # console.log '********   f ->'
    c.flushdb (err) ->
      throw Error err if err
      # console.log '********   f <-'
      c.quit()
      done()


  runTests create, destroy, yes


  describe 'redis specific tests', ->
    beforeEach ->
      @redis = @driver.redis
      @cName = 'users'

    it 'has no dangling listeners after subscribing and unsubscribing', (done) ->
      @driver.subscribe 'users', @docName, 0, {}, (err, stream) =>
        throw Error err if err
        assert.equal @driver.numStreams, 1 # Check
        stream.destroy()

        @driver.bulkSubscribe {users:{a:0, b:0}}, (err, response) =>
          throw Error err if err

          assert.equal @driver.numStreams, 2 # Check
          response.users.a.destroy()
          response.users.b.destroy()

          # I want to count the number of subscribed channels. Redis 2.8 adds
          # the 'pubsub' command, which does this. However, I can't rely on
          # pubsub existing so I'll use a dodgy method.
          #redis.send_command 'pubsub', ['CHANNELS'], (err, channels) ->
          @redis.publish "15 #{@cName}.#{@docName}", '{}', (err, numSubscribers) =>
            assert.equal numSubscribers, 0
            assert.equal @driver.numStreams, 0
            assert.deepEqual Object.keys(@driver.streams), []
            done()

    it 'repopulates the persistant oplog if data is missing', (done) ->
      @redis.set "users.#{@docName} v", 2
      @redis.rpush "users.#{@docName} ops",
        JSON.stringify({create:{type:'text'}}),
        JSON.stringify({op:['hi']}),
        (err) =>
          throw Error err if err
          @driver.atomicSubmit 'users', @docName, v:2, op:['yo'], {}, (err) =>
            throw Error err if err

            # And now the actual test - does the persistant oplog have our data?
            @oplog.getVersion 'users', @docName, (err, v) =>
              throw Error err if err
              assert.strictEqual v, 3
              @getOps 'users', @docName, 0, null, (err, ops) =>
                throw Error err if err
                assert.strictEqual ops.length, 3
                done()

    it 'works if the data in redis is missing', (done) -> @create =>
      @redis.flushdb =>
        @getOps 'users', @docName, 0, null, (err, ops) =>
          throw new Error err if err
          assert.equal ops.length, 1

          @driver.atomicSubmit 'users', @docName, v:1, op:['hi'], {}, (err) =>
            throw new Error err if err
            @getOps 'users', @docName, 0, null, (err, ops) =>
              throw new Error err if err
              assert.equal ops.length, 2
              done()

    it 'ignores redis operations if the version isnt set', (done) -> @create =>
      @redis.del "users.#{@docName} v", (err, result) =>
        throw Error err if err
        # If the key format ever changes, this test should fail instead of becoming silently
        # ineffective
        assert.equal result, 1

        @redis.lset "#{@cName}.#{@docName} ops", 0, "junk that will crash livedb", (err) =>
          throw Error err if err
          @driver.atomicSubmit 'users', @docName, v:1, op:['hi'], {}, (err, v) =>
            throw new Error err if err
            @getOps 'users', @docName, 0, null, (err, ops) =>
              throw new Error err if err
              assert.equal ops.length, 2
              done()

    it 'works if data in the oplog is missing', (done) ->
      # This test depends on the actual format in redis. Avoid adding
      # too many tests like this - its brittle.
      @redis.set "#{@cName}.#{@docName} v", 2
      @redis.rpush "#{@cName}.#{@docName} ops",
        JSON.stringify({create:{type:'text'}}),
        JSON.stringify({op:['hi']}),
        (err) =>
          throw Error err if err

          @driver.getOps @cName, @docName, 0, null, (err, ops) ->
            throw Error err if err
            assert.equal ops.length, 2          
            done()

    it 'removes junk in the redis oplog on submit', (done) -> @create =>
      @redis.del "#{@cName}.#{@docName} v", (err, result) =>
        throw Error err if err
        assert.equal result, 1

        @redis.lset "#{@cName}.#{@docName} ops", 0, "junk that will crash livedb", (err) =>

          @driver.atomicSubmit 'users', @docName, v:1, op:['hi'], {}, (err, v) =>
            throw new Error err if err
            @getOps 'users', @docName, 0, null, (err, ops) =>
              throw new Error err if err
              assert.equal ops.length, 2
              done()

    describe 'does not hit the database if the version is current in redis', ->
      beforeEach (done) -> @create =>
        @oplog.getVersion = -> throw Error 'getVersion should not be called'
        @oplog.getOps = -> throw Error 'getOps should not be called'
        done()

      it 'from previous version', (done) ->
        # This one operation is in redis. It should be fetched.
        @driver.getOps 'users', @docName, 0, null, (err, ops) =>
          throw new Error err if err
          assert.strictEqual ops.length, 1
          done()

      it 'from current version', (done) ->
        # Redis knows that the document is at version 1, so we should return [] here.
        @driver.getOps 'users', @docName, 1, null, (err, ops) ->
          throw new Error err if err
          assert.deepEqual ops, []
          done()

    it 'correctly namespaces pubsub operations so other collections dont get confused'

