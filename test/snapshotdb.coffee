# This is a test suite for snapshot database implementations
assert = require 'assert'
ottypes = require 'ottypes'

counter = 1

module.exports = (create, noBulkGetSnapshot) ->
  if create.length is 0
    innerCreate = create
    create = (callback) ->
      callback(innerCreate())

  describe 'snapshot db', ->
    beforeEach (done) ->
      @cName = 'testcollection'
      @docName = "snapshottest #{counter++}"
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
      data = {v:5, type:ottypes.text.uri, data:'hi there', m:{ctime:1, mtime:2}}
      @db.writeSnapshot @cName, @docName, data, (err) =>
        throw Error(err) if err
        @db.getSnapshot @cName, @docName, (err, storedData) ->
          delete storedData.docName # The result is allowed to contain this but its ignored.
          assert.deepEqual data, storedData
          done()

    it 'will remove data fields if the data has been deleted', (done) ->
      data = {v:5, type:ottypes.text.uri, data:'hi there', m:{ctime:1, mtime:2}}
      @db.writeSnapshot @cName, @docName, data, (err) =>
        throw Error(err) if err
        @db.writeSnapshot @cName, @docName, {v:6}, (err) =>
          throw Error(err) if err
          @db.getSnapshot @cName, @docName, (err, storedData) ->
            throw Error(err) if err
            assert.equal storedData.data, null
            assert.equal storedData.type, null
            assert.equal storedData.m, null
            assert.equal storedData.v, 6
            done()

    if !noBulkGetSnapshot then describe 'bulk get snapshot', ->
      it 'does not return missing documents', (done) ->
        @db.bulkGetSnapshot {testcollection:[@docName]}, (err, results) ->
          throw Error(err) if err
          assert.deepEqual results, {testcollection:[]}
          done()

      it 'returns results', (done) ->
        data = {v:5, type:ottypes.text.uri, data:'hi there', m:{ctime:1, mtime:2}}
        @db.writeSnapshot @cName, @docName, data, (err) =>
          throw Error(err) if err
          @db.bulkGetSnapshot {testcollection:[@docName]}, (err, results) =>
            throw Error(err) if err
            expected = {testcollection:{}}
            expected.testcollection[@docName] = data
            delete results[@cName][@docName].docName
            assert.deepEqual results, expected
            done()

      it "works when some results exist and some don't", (done) ->
        data = {v:5, type:ottypes.text.uri, data:'hi there', m:{ctime:1, mtime:2}}
        @db.writeSnapshot @cName, @docName, data, (err) =>
          throw Error(err) if err
          @db.bulkGetSnapshot {testcollection:['does not exist', @docName, 'also does not exist']}, (err, results) =>
            throw Error(err) if err
            expected = {testcollection:{}}
            expected.testcollection[@docName] = data
            delete results[@cName][@docName].docName
            assert.deepEqual results, expected
            done()

    else
      console.warn 'Warning: db.bulkGetSnapshot not defined in snapshot db. Bulk subscribes will be slower.'

