# This file contains generic tests for livedb driver implementations. All driver implementations
# should pass these tests.

# These tests are exported, and should be fired from a driver-specific test runner. See the other
# driver tests for examples.

assert = require 'assert'
async = require 'async'
MemoryStore = require '../lib/memory'

createOp = (v = 0) ->
  if v == 0
    {v, create:{type:'text', data:'hi'}, m:{}}
  else
    {v, op:['x'], m:{}}

nextDocId = 0

module.exports = runTests = (createDriver, destroyDriver, distributed = no) ->
  beforeEach ->  
    # Each test gets its own doc id, if it wants it.
    @docName = "id#{nextDocId++}"

    @create = (cb) ->
      @driver.atomicSubmit 'users', @docName, createOp(), null, (err) ->
        throw new Error err if err
        cb?()

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
    # for subType in ['single', 'bulk'] then do (subType) -> describe subType, ->
    for subType in ['single'] then do (subType) -> describe subType, ->
      beforeEach ->
        @subscribe = if subType is 'single'
          @driver.subscribe.bind @driver
        else
          (cName, docName, v, options, callback) =>
            request = {}
            request[cName] = {}
            request[cName][docName] = v
            @driver.bulkSubscribe request, (err, streams) =>
              callback err, if streams then streams[cName]?[docName]

      it 'observes local changes', (done) -> @create =>
        @subscribe 'users', @docName, 1, {}, (err, stream) =>
          throw new Error err if err

          stream.once 'data', (op) ->
            assert.deepEqual op, createOp(1)
            stream.destroy()
            done()

          @driver.atomicSubmit 'users', @docName, createOp(1), {}, ->

      it 'sees ops when you observe an old version', (done) -> @create =>
        # The document has version 1
        @subscribe 'users', @docName, 0, {}, (err, stream) =>
          stream.once 'data', (data) =>
            assert.deepEqual data, createOp()
            done()

      it 'still works when you observe an old version', (done) -> @create =>
        @subscribe 'users', @docName, 0, {}, (err, stream) =>
          @driver.atomicSubmit 'users', @docName, createOp(1), {}, ->
          stream.on 'data', (data) ->
            return if data.v is 0
            assert.deepEqual data, createOp(1)
            stream.destroy()
            done()

      it 'can observe a document that doesnt exist yet', (done) ->
        @subscribe 'users', @docName, 0, {}, (err, stream) =>
          stream.on 'readable', ->
            assert.deepEqual stream.read(), createOp()
            stream.destroy()
            done()

          @create()

      it 'does not throw when you double stream.destroy', (done) ->
        @subscribe 'users', @docName, 1, {}, (err, stream) =>
          stream.destroy()
          stream.destroy()
          done()

      it.skip 'does not let you subscribe with a future version', (done) ->
        @subscribe 'users', @docName, 100, {}, (err, stream) ->
          assert.strictEqual err, 'Cannot subscribe to future version'
          assert.equal stream, null
          done()


  describe 'distributed load', ->
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

