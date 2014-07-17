# This is a mocha test suite for oplog implementations
#
#
# getOps collection, docName, start, end
assert = require 'assert'
textType = require('ot-text').type

# Wait for the returned function to be called a given number of times, then call the
# callback.
makePassPart = (n, callback) ->
  remaining = n
  ->
    remaining--
    if remaining == 0
      callback()
    else if remaining < 0
      throw new Error "expectCalls called more than #{n} times"

counter = 1

module.exports = (create) ->
  describe 'oplog', ->
    beforeEach (done) ->
      @cName = 'testcollection'
      @docName = "optest #{counter++}"

      # Work with syncronous and asyncronous create() methods using their arity.
      if create.length is 0
        @db = create()
        done()
      else
        create (@db) =>
          done()


    afterEach ->
      @db.close()

    it 'returns 0 when getVersion is called on a new document', (done) ->
      @db.getVersion @cName, @docName, (err, v) ->
        throw new Error err if err
        assert.strictEqual v, 0
        done()

    it 'writing an operation bumps the version', (done) ->
      @db.writeOp @cName, @docName, {v:0, create:{type:textType.uri}}, (err) =>
        throw new Error err if err
        @db.getVersion @cName, @docName, (err, v) =>
          throw new Error err if err
          assert.strictEqual v, 1
          @db.writeOp @cName, @docName, {v:1, op:['hi']}, (err) =>
            @db.getVersion @cName, @docName, (err, v) ->
              throw new Error err if err
              assert.strictEqual v, 2
              done()

    it 'ignores subsequent attempts to write the same operation', (done) ->
      @db.writeOp @cName, @docName, {v:0, create:{type:textType.uri}}, (err) =>
        throw new Error err if err
        @db.writeOp @cName, @docName, {v:0, create:{type:textType.uri}}, (err) =>
          throw new Error err if err

          @db.getVersion @cName, @docName, (err, v) =>
            throw new Error err if err
            assert.strictEqual v, 1
            @db.getOps @cName, @docName, 0, null, (err, ops) ->
              assert.strictEqual ops.length, 1
              done()

    it 'does not decrement the version when receiving old ops', (done) ->
      @db.writeOp @cName, @docName, {v:0, create:{type:textType.uri}}, (err) =>
        throw new Error err if err
        @db.writeOp @cName, @docName, {v:1, op:['hi']}, (err) =>
          throw new Error err if err
          @db.writeOp @cName, @docName, {v:0, create:{type:textType.uri}}, (err) =>
            throw new Error err if err
            @db.getVersion @cName, @docName, (err, v) =>
              throw new Error err if err
              assert.strictEqual v, 2
              done()

    it 'ignores concurrent attempts to write the same operation', (done) ->
      @db.writeOp @cName, @docName, {v:0, create:{type:textType.uri}}, (err) =>
        throw new Error err if err
      @db.writeOp @cName, @docName, {v:0, create:{type:textType.uri}}, (err) =>
        throw new Error err if err

        @db.getVersion @cName, @docName, (err, v) =>
          throw new Error err if err
          assert.strictEqual v, 1
          @db.getOps @cName, @docName, 0, null, (err, ops) ->
            assert.strictEqual ops.length, 1
            done()

    describe 'getOps', ->
      it 'returns [] for a nonexistant document, with any arguments', (done) ->
        num = 0
        check = (error, ops) ->
          throw new Error error if error
          assert.deepEqual ops, []
          done() if ++num is 7

        @db.getOps @cName, @docName, 0, 0, check
        @db.getOps @cName, @docName, 0, 1, check
        @db.getOps @cName, @docName, 0, 10, check
        @db.getOps @cName, @docName, 0, null, check
        @db.getOps @cName, @docName, 10, 10, check
        @db.getOps @cName, @docName, 10, 11, check
        @db.getOps @cName, @docName, 10, null, check

      it 'returns ops', (done) ->
        num = 0
        check = (expected) -> (error, ops) ->
          throw new Error error if error
          if ops then delete op.v for op in ops
          assert.deepEqual ops, expected
          done() if ++num is 5

        opData = {v:0, op:[{p:0,i:'hi'}], meta:{}, src:'abc', seq:123}
        @db.writeOp @cName, @docName, opData, =>
          delete opData.v
          @db.getOps @cName, @docName, 0, 0, check []
          @db.getOps @cName, @docName, 0, 1, check [opData]
          @db.getOps @cName, @docName, 0, null, check [opData]
          @db.getOps @cName, @docName, 1, 1, check []
          @db.getOps @cName, @docName, 1, null, check []

