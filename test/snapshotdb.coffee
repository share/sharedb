# This is a test suite for snapshot database implementations
assert = require 'assert'
textType = require('ot-text').type
jsonType = require('ot-json0').type
monkeypatch = require '../lib/monkeypatch'

counter = 1

module.exports = (create) ->

  describe 'snapshot db', ->
    beforeEach (done) ->
      @cName = 'testcollection'
      @docName = "snapshottest #{counter++}"
      create (@db) =>
        monkeypatch.db @db
        done()

    afterEach (done) ->
      @db.close done

    it 'returns null when you getSnapshot on a nonexistant doc name', (done) ->
      @db.getSnapshot @cName, @docName, null, (err, data) ->
        throw Error(err) if err
        assert.equal data, null
        done()

    it 'will store data', (done) ->
      data = {v:5, type:textType.uri, data:'hi there', m:{ctime:1, mtime:2}}
      @db.writeSnapshot @cName, @docName, data, (err) =>
        throw Error(err) if err
        @db.getSnapshot @cName, @docName, null, (err, storedData) =>
          data.docName = @docName
          # Metadata should be saved but not returned
          delete data.m
          assert.deepEqual data, storedData
          done()

    it 'calling writeSnapshot without a type deletes the document', (done) ->
      data = {v:5, type:textType.uri, data:'hi there', m:{ctime:1, mtime:2}}
      @db.writeSnapshot @cName, @docName, data, (err) =>
        throw Error(err) if err
        @db.writeSnapshot @cName, @docName, {v:6}, (err) =>
          throw Error(err) if err
          @db.getSnapshot @cName, @docName, null, (err, storedData) =>
            throw Error(err) if err
            assert.equal storedData, null
            done()

    it 'projection', (done) ->
      data = {v:5, type:jsonType.uri, data:{x:5, y:6}, m:{ctime:1, mtime:2}}
      @db.writeSnapshot @cName, @docName, data, (err) =>
        throw Error err if err
        @db.getSnapshot @cName, @docName, {x:true, z:true}, (err, data) =>
          throw Error err if err
          expected = {v:5, type:jsonType.uri, data:{x:5}, docName: @docName}
          assert.deepEqual data, expected
          done()

    it 'getSnapshots does not return missing documents', (done) ->
      @db.getSnapshots @cName, [@docName], null, (err, results) =>
        throw Error(err) if err
        assert.deepEqual results, []
        done()

    it 'getSnapshots returns results', (done) ->
      data = {v:5, type:textType.uri, data:'hi there', m:{ctime:1, mtime:2}}
      @db.writeSnapshot @cName, @docName, data, (err) =>
        throw Error(err) if err
        @db.getSnapshots @cName, [@docName], null, (err, results) =>
          throw Error(err) if err
          data.docName = @docName
          delete data.m
          assert.deepEqual results, [data]
          done()

    it 'getSnapshots works when some results exist and some do not', (done) ->
      @docName2 = @docName + ' ' + 2
      data = {v:5, type:textType.uri, data:'hi there'}
      data2 = {v:7, type:textType.uri, data:'yo'}
      @db.writeSnapshot @cName, @docName, data, (err) =>
        throw Error(err) if err
        @db.writeSnapshot @cName, @docName2, data2, (err) =>
          throw Error(err) if err
          docNames = ['does not exist', @docName, 'also does not exist', @docName2]
          @db.getSnapshots @cName, docNames, null, (err, results) =>
            throw Error(err) if err
            data.docName = @docName
            data2.docName = @docName2
            # Result order is not strictly specified
            expected = if results[0].docName == @docName then [data, data2] else [data2, data]
            assert.deepEqual results, expected
            done()
