# This is a test suite for snapshot database implementations
assert = require 'assert'
ottypes = require 'ottypes'

counter = 1

module.exports = (create) ->
  describe 'snapshot db', ->
    beforeEach ->
      @db = create()
      @cName = 'users'
      @docName = "doc #{counter++}"

    afterEach ->
      @db.close()

    
    it 'returns null when you getSnapshot on a nonexistant doc name', (done) ->
      @db.getSnapshot @cName, @docName, (err, data) ->
        assert.ifError err
        assert.equal data, null
        done()

    it 'will store data', (done) ->
      data = {v:5, type:ottypes.text.uri, data:'hi there'}
      @db.setSnapshot @cName, @docName, data, (err) =>
        assert.ifError err
        @db.getSnapshot @cName, @docName, (err, storedData) ->
          assert.deepEqual data, storedData
          done()

    it 'will remove data fields if the data has been deleted', (done) ->
      @db.setSnapshot @cName, @docName, {v:5, type:ottypes.text.uri, data:'hi there'}, (err) =>
        assert.ifError err
        @db.setSnapshot @cName, @docName, {v:6}, (err) =>
          assert.ifError err
          @db.getSnapshot @cName, @docName, (err, storedData) ->
            assert.deepEqual storedData, {v:6}
            done()


