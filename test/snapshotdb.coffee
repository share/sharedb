# This is a test suite for snapshot database implementations
assert = require 'assert'
ottypes = require 'ottypes'

counter = 1

module.exports = (create) ->
  # Test if the database has getBulkSnapshots so we know to run the tests (below).
  db = create()
  db.close()

  describe 'snapshot db', ->
    beforeEach (done) ->
      @cName = 'testcollection'
      @docName = "snapshottest #{counter++}"
      if create.length is 0
        @db = create()
        done()
      else
        create (@db) =>
          done()

    afterEach ->
      @db.close()

    
    it 'returns null when you getSnapshot on a nonexistant doc name', (done) ->
      @db.getSnapshot @cName, @docName, (err, data) ->
        throw Error(err) if err
        assert.equal data, null
        done()

    it 'will store data', (done) ->
      data = {v:5, type:ottypes.text.uri, data:'hi there'}
      @db.writeSnapshot @cName, @docName, data, (err) =>
        throw Error(err) if err
        @db.getSnapshot @cName, @docName, (err, storedData) ->
          delete storedData.docName # The result is allowed to contain this but its ignored.
          assert.deepEqual data, storedData
          done()

    it 'will remove data fields if the data has been deleted', (done) ->
      @db.writeSnapshot @cName, @docName, {v:5, type:ottypes.text.uri, data:'hi there'}, (err) =>
        throw Error(err) if err
        @db.writeSnapshot @cName, @docName, {v:6}, (err) =>
          throw Error(err) if err
          @db.getSnapshot @cName, @docName, (err, storedData) ->
            assert.equal storedData.data, null
            assert.equal storedData.type, null
            assert.equal storedData.v, 6
            done()

    if db.bulkGetSnapshot then describe 'bulk get snapshot', ->
      it 'does not return missing documents', (done) ->
        @db.bulkGetSnapshot {testcollection:[@docName]}, (err, results) ->
          throw Error(err) if err
          assert.deepEqual results, {testcollection:[]}
          done()

      it 'returns results', (done) ->
        data = {v:5, type:ottypes.text.uri, data:'hi there'}
        @db.writeSnapshot @cName, @docName, data, (err) =>
          throw Error(err) if err
          @db.bulkGetSnapshot {testcollection:[@docName]}, (err, results) =>
            expected = {testcollection:{}}
            expected.testcollection[@docName] = data
            assert.deepEqual results, expected
            done()

      it "works when some results exist and some don't", (done) ->
        data = {v:5, type:ottypes.text.uri, data:'hi there'}
        @db.writeSnapshot @cName, @docName, data, (err) =>
          throw Error(err) if err
          @db.bulkGetSnapshot {testcollection:['does not exist', @docName, 'also does not exist']}, (err, results) =>
            expected = {testcollection:{}}
            expected.testcollection[@docName] = data
            assert.deepEqual results, expected
            done()

    else
      console.warn 'Warning: db.bulkGetSnapshot not defined in snapshot db. Bulk subscribes will be slower.'

