# This file contains generic tests for livedb driver implementations. All driver implementations
# should pass these tests.

assert = require 'assert'
async = require 'async'
MemoryStore = require '../lib/memory'

createOp = (v = 0) ->
  if v == 0
    {v, create:{type:'text', data:'hi'}}
  else
    {v, op:['x']}

module.exports = runTests = (createDriver, destroyDriver, distributed = no) -> #describe 'livedb driver', ->
  beforeEach ->
    # A wrapper which calls getOps on both the oplog and driver to make sure they return the same
    # thing.
    @getOps = (cName, docName, from, to, callback) =>
      # Calling both in parallel so we hit more timing problems
      async.parallel [
        # Explicit callback because sometimes we return the version as well in getOps.
        (cb) => @oplog.getOps cName, docName, from, to, (err, ops) -> cb err, ops
        (cb) => @driver.getOps cName, docName, from, to, (err, ops) -> cb err, ops
      ], (err, results) ->
        return callback err if err
        assert.deepEqual results[0], results[1]
        callback null, results[0]

    @oplog = MemoryStore()
    @driver = createDriver @oplog

  afterEach ->
    destroyDriver @driver

  describe 'atomicSubmit', ->
    it 'writes the op to the oplog', (done) ->
      @driver.atomicSubmit 'users', 'seph', createOp(), {}, (err) =>
        throw Error err if err
        @oplog.getVersion 'users', 'seph', (err, v) ->
          throw Error err if err
          assert.strictEqual v, 1
          done()

    it 'allows exactly one write at a given version to succeed', (done) ->
      # In this test we try and write an operation 100 times. It should succeed once, and the rest
      # should fail.
      num = 100

      written = false
      count = 0

      cb = (err) =>
        # err should be null (the write succeeded) or 'Transform needed' if there was already data.
        # Any other value indicates a real error.
        count++
        assert count <= num

        if !err?
          throw 'Multiple writes accepted' if written
          written = true
        else if err isnt 'Transform needed'
          throw Error err

        if count is num
          throw 'No writes accepted' if !written
          @oplog.getVersion 'users', 'seph', (err, v) ->
            throw Error err if err
            assert.strictEqual v, 1
            done()

      for [1..num]
        @driver.atomicSubmit 'users', 'seph', createOp(), {}, cb

    it 'allows exactly one write across many clients to succeed', if distributed then (done) ->
      @timeout 5000
      # There is a variant of this test done at the livedb level. If this test passes but the other
      # distributed test does not, there's a bug in livedb core.

      numClients = 50 # You can go way higher, but it slows down.

      @oplog.writeOp 'users', 'seph', createOp(0), (err) =>
        throw Error err if err

        # We have to share the database here because these tests are written
        # against the memory API, which doesn't share data between instances.
        drivers = (createDriver @oplog for [0...numClients])

        written = false
        for d, i in drivers
          submitCount = 0
          observeCount = 0
          doneWork = (isSubmit) =>
            if submitCount == numClients and !written
              throw Error 'Op not accepted anywhere'

            if submitCount == numClients and observeCount == numClients
              destroyDriver d for d in drivers
              @getOps 'users', 'seph', 1, null, (err, ops) ->
                throw Error err if err
                assert.equal ops.length, 1
                # console.log '-----------done-----------'
                done()

          do (d, i) =>
            # Delayed so that some subscribes are complete before the op is submitted successfully
            setTimeout =>
              d.atomicSubmit 'users', 'seph', v:1, op:["driver #{i} "], {}, (err) =>
                if !err?
                  throw Error 'Multiple writes accepted' if written
                  written = true
                  # console.log "****** WRITTEN *******"
                else if err isnt 'Transform needed'
                  throw Error err

                submitCount++
                # console.log "op", submitCount
                doneWork()
            , 100 * Math.random()

            d.subscribe 'users', 'seph', 1, {}, (err, stream) =>
              # console.log "subscribed", i
              read = null
              stream.on 'data', (data) =>
                if read
                  console.error data, read
                  throw Error "Duplicate reads"
                read = data
                assert.strictEqual data.v, 1
                assert.ok data.op
                observeCount++
                # console.log "seen", observeCount
                doneWork()

    it 'forwards submitted ops to the oplog', (done) ->
      @driver.atomicSubmit 'users', 'seph', createOp(0), {}, (err) =>
        throw Error err if err
        @driver.atomicSubmit 'users', 'seph', createOp(1), {}, (err) =>
          throw Error err if err
          @driver.atomicSubmit 'users', 'seph', createOp(2), {}, (err) =>
            throw Error err if err
            @getOps 'users', 'seph', 0, null, (err, ops) ->
              throw Error err if err
              assert.deepEqual ops, (createOp(v) for v in [0..2])
              done()


  describe 'bulkGetOpsSince', ->
    it 'handles multiple gets which are missing from the oplog', (done) -> # regression
      # Nothing cached, but the data from two documents is in the database.
      @oplog.writeOp 'test', 'one', createOp(0), =>
        @oplog.writeOp 'test', 'two', createOp(0), =>

          @driver.bulkGetOpsSince {test:{one:0, two:0}}, (err, result) ->
            throw Error err if err
            assert.deepEqual result,
              test:
                one: [createOp(0)]
                two: [createOp(0)]
            done()

  describe 'subscribe', ->
    it 'sends ops into the stream'



describe 'inprocess driver', ->
  runTests require('../lib/inprocessdriver'), (driver) -> driver.destroy()

describe 'redis driver', ->
  redisLib = require 'redis'

  # redisLib.createClient().eval """redis.log(redis.LOG_WARNING, '--------------')""", 0, ->
  create = (oplog) ->
    createDriver = require '../lib/redisdriver'
    redis = redisLib.createClient()
    redis.select redis.selected_db = 15
    return createDriver oplog, redis

  destroy = (driver) ->
    driver.redis.flushdb()
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
