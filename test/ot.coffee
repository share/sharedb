# Unit tests for lib/ot.js
#
# This tests to make sure it does some of the right things WRT OT.
#
# Note that there's also OT code in other livedb files. This file does not
# contain any integration tests.

assert = require 'assert'

text = require('ot-text').type

ot = require '../lib/ot'

describe 'ot', ->
  before ->
    # apply and normalize put a creation / modification timestamp on snapshots
    # & ops. We'll verify its correct by checking that its in the range of time
    # from when the tests start running to 10 seconds after the tests start
    # running. Hopefully the tests aren't slower than that.
    before = Date.now()
    after = before + 10 * 1000
    checkMetaTs = (field) -> (data) ->
      assert.ok data.m
      assert.ok before <= data.m[field] < after
      delete data.m[field]
      data

    @checkOpTs = checkMetaTs 'ts'
    @checkDocCreate = checkMetaTs 'ctime'
    @checkDocModified = checkMetaTs 'mtime'
    @checkDocTs = (doc) =>
      @checkDocCreate doc
      @checkDocModified doc
      doc

  describe 'checkOpData', ->
    it 'fails if opdata is not an object', ->
      assert.ok ot.checkOpData 'hi'
      assert.ok ot.checkOpData()
      assert.ok ot.checkOpData 123
      assert.ok ot.checkOpData []

    it 'fails if op data is missing op, create and del', ->
      assert.ok ot.checkOpData {v:5}

    it 'fails if src/seq data is invalid', ->
      assert.ok ot.checkOpData {del:true, v:5, src:'hi'}
      assert.ok ot.checkOpData {del:true, v:5, seq:123}
      assert.ok ot.checkOpData {del:true, v:5, src:'hi', seq:'there'}

    it 'fails if a create operation is missing its type', ->
      assert.ok ot.checkOpData {create:{}}
      assert.ok ot.checkOpData {create:123}

    it 'fails if the type is missing', ->
      assert.ok ot.checkOpData {create:{type:"something that does not exist"}}

    it 'accepts valid create operations', ->
      assert.equal null, ot.checkOpData {create:{type:text.uri}}
      assert.equal null, ot.checkOpData {create:{type:text.uri, data:'hi there'}}

    it 'accepts valid delete operations', ->
      assert.equal null, ot.checkOpData {del:true}

    it 'accepts valid ops', ->
      assert.equal null, ot.checkOpData {op:[1,2,3]}

  describe 'normalize', ->
    it 'expands type names in normalizeType', ->
      assert.equal text.uri, ot.normalizeType 'text'

    it 'expands type names in an op', ->
      opData = create:type:'text'
      ot.normalize opData
      @checkOpTs opData
      assert.deepEqual opData, {create:{type:text.uri}, m:{}, src:''}

  describe 'apply', ->
    it 'fails if the versions dont match', ->
      assert.equal 'Version mismatch', ot.apply {v:5}, {v:6, create:{type:text.uri}}
      assert.equal 'Version mismatch', ot.apply {v:5}, {v:6, del:true}
      assert.equal 'Version mismatch', ot.apply {v:5}, {v:6, op:[]}

    it 'allows the version field to be missing', ->
      assert.equal null, ot.apply {v:5}, {create:{type:text.uri}}
      assert.equal null, ot.apply {}, {v:6, create:{type:text.uri}}

    describe 'create', ->
      it 'fails if the document already exists', ->
        doc = {v:6, create:{type:text.uri}}
        assert.equal 'Document already exists', ot.apply {v:6, type:text.uri, data:'hi'}, doc
        # The doc should be unmodified
        assert.deepEqual doc, {v:6, create:{type:text.uri}}

      it 'creates doc data correctly when no initial data is passed', ->
        doc = {v:5}
        assert.equal null, ot.apply doc, {v:5, create:{type:text.uri}}
        @checkDocTs doc
        assert.deepEqual doc, {v:6, type:text.uri, m:{}, data:''}

      it 'creates doc data when it is given initial data', ->
        doc = {v:5}
        assert.equal null, ot.apply doc, {v:5, create:{type:text.uri, data:'Hi there'}}
        @checkDocTs doc
        assert.deepEqual doc, {v:6, type:text.uri, m:{}, data:'Hi there'}

      it.skip 'runs pre and post validation functions'

    describe 'del', ->
      it 'deletes the document data', ->
        doc = {v:6, type:text.uri, data:'Hi there'}
        assert.equal null, ot.apply doc, {v:6, del:true}
        delete doc.m.mtime
        assert.deepEqual doc, {v:7, m:{}}

      it 'still works if the document doesnt exist anyway', ->
        doc = {v:6}
        assert.equal null, ot.apply doc, {v:6, del:true}
        delete doc.m.mtime
        assert.deepEqual doc, {v:7, m:{}}

      it 'keeps any metadata from op on the doc', ->
        doc = {v:6, type:text.uri, m:{ctime:1, mtime:2}, data:'hi'}
        assert.equal null, ot.apply doc, {v:6, del:true}
        delete doc.m.mtime
        assert.deepEqual doc, {v:7, m:{ctime:1}}

    describe 'op', ->
      it 'fails if the document does not exist', ->
        assert.equal 'Document does not exist', ot.apply {v:6}, {v:6, op:[1,2,3]}

      it 'fails if the type is missing', ->
        assert.equal 'Type not found', ot.apply {v:6, type:'some non existant type'}, {v:6, op:[1,2,3]}

      it 'applies the operation to the document data', ->
        doc = {v:6, type:text.uri, data:'Hi'}
        assert.equal null, ot.apply doc, {v:6, op:[2, ' there']}
        @checkDocModified doc
        assert.deepEqual doc, {v:7, type:text.uri, m:{}, data:'Hi there'}

      it 'updates mtime', ->
        doc = {v:6, type:text.uri, m:{ctime:1, mtime:2}, data:'Hi'}
        assert.equal null, ot.apply doc, {v:6, op:[2, ' there']}
        @checkDocModified doc
        assert.deepEqual doc, {v:7, type:text.uri, m:{ctime:1}, data:'Hi there'}

      it.skip 'shatters the operation if it can, and applies it incrementally'

    describe 'noop', ->
      it 'works on existing docs', ->
        doc = {v:6, type:text.uri, m:{ctime:1, mtime:2}, data:'Hi'}
        assert.equal null, ot.apply doc, {v:6}
        # same, but with v+1.
        assert.deepEqual doc, {v:7, type:text.uri, m:{ctime:1, mtime:2}, data:'Hi'}

      it 'works on nonexistant docs', ->
        doc = {v:0}
        assert.equal null, ot.apply doc, {v:0}
        assert.deepEqual doc, {v:1}

  describe 'transform', ->
    it 'fails if the version is specified on both and does not match', ->
      op1 = {v:5, op:[10, 'hi']}
      op2 = {v:6, op:[5, 'abcde']}
      assert.equal 'Version mismatch', ot.transform text.uri, op1, op2
      assert.deepEqual op1, {v:5, op:[10, 'hi']}

    # There's 9 cases here.
    it 'create by create fails', ->
      assert.equal 'Document created remotely', ot.transform null, {v:10, create:type:text.uri}, {v:10, create:type:text.uri}

    it 'create by delete fails', ->
      assert.ok ot.transform null, {create:type:text.uri}, {del:true}

    it 'create by op fails', ->
      assert.equal 'Document created remotely', ot.transform null, {v:10, create:type:text.uri}, {v:10, op:[15, 'hi']}

    it 'create by noop ok', ->
      op = {create:{type:text.uri}, v:6}
      assert.equal null, ot.transform null, op, {v:6}
      assert.deepEqual op, {create:{type:text.uri}, v:7}

    it 'delete by create fails', ->
      assert.ok ot.transform null, {del:true}, {create:type:text.uri}

    it 'delete by delete ok', ->
      op = del:true, v:6
      assert.equal null, ot.transform text.uri, op, {del:true, v:6}
      assert.deepEqual op, {del:true, v:7}

      op = del:true # And with no version specified should work too.
      assert.equal null, ot.transform text.uri, op, {del:true, v:6}
      assert.deepEqual op, del:true

    it 'delete by op ok', ->
      op = del:true, v:8
      assert.equal null, ot.transform text.uri, op, {op:[], v:8}
      assert.deepEqual op, {del:true, v:9}

      op = del:true # And with no version specified should work too.
      assert.equal null, ot.transform text.uri, op, {op:[], v:8}
      assert.deepEqual op, {del:true}

    it 'delete by noop ok', ->
      op = {del:true, v:6}
      assert.equal null, ot.transform null, op, {v:6}
      assert.deepEqual op, {del:true, v:7}

      op = {del:true}
      assert.equal null, ot.transform null, op, {v:6}
      assert.deepEqual op, {del:true}

    it 'op by create fails', ->
      assert.ok ot.transform null, {op:{}}, {create:type:text.uri}

    it 'op by delete fails', ->
      assert.equal 'Document was deleted', ot.transform text.uri, {v:10, op:[]}, {v:10, del:true}

    it 'op by op ok', ->
      op1 = {v:6, op:[10, 'hi']}
      op2 = {v:6, op:[5, 'abcde']}
      assert.equal null, ot.transform text.uri, op1, op2
      assert.deepEqual op1, {v:7, op:[15, 'hi']}

      op1 = {op:[10, 'hi']} # No version specified
      op2 = {v:6, op:[5, 'abcde']}
      assert.equal null, ot.transform text.uri, op1, op2
      assert.deepEqual op1, {op:[15, 'hi']}

    it 'op by noop ok', ->
      # I don't think this is ever used, but whatever.
      op = {v:6, op:[10, 'hi']}
      assert.equal null, ot.transform text.uri, op, {v:6}
      assert.deepEqual op, {v:7, op:[10, 'hi']}

    it 'noop by anything is ok', ->
      op = {}
      assert.equal null, ot.transform text.uri, op, {v:6, op:[10, 'hi']}
      assert.deepEqual op, {}
      assert.equal null, ot.transform text.uri, op, {del:true}
      assert.deepEqual op, {}
      assert.equal null, ot.transform null, op, {create:type:text.uri}
      assert.deepEqual op, {}
      assert.equal null, ot.transform null, op, {}
      assert.deepEqual op, {}

    # And op by op is tested in the first couple of tests.

  describe 'applyPresence', ->
    it 'sets', ->
      p = {data:{}}
      assert.equal null, ot.applyPresence p, {val:{id:{y:6}}}
      assert.deepEqual p, data:{id:{y:6}}

      assert.equal null, ot.applyPresence p, {p:['id'], val:{z:7}}
      assert.deepEqual p, data:{id:{z:7}}

      assert.equal null, ot.applyPresence p, {p:['id','z'], val:8}
      assert.deepEqual p, data:{id:{z:8}}

    it 'clears data', ->
      p = {data:{id:{name:'sam'}}}
      assert.equal null, ot.applyPresence p, {val:null}
      assert.deepEqual p, data:{}

    it "doesn't allow special keys other than _cursor", ->
      p = {}
      # assert.equal 'Cannot set reserved value', ot.applyPresence p, {val:{id:{_x:'hi'}}}
      # assert.deepEqual p, {}
      assert.equal 'Cannot set reserved value', ot.applyPresence p, {p:['id'], val:{_x:'hi'}}
      assert.deepEqual p, {}
      assert.equal 'Cannot set reserved value', ot.applyPresence p, {p:['id','_x'], val:'hi'}
      assert.deepEqual p, {}

  describe 'transformPresence', ->
    it 'updates cursor positions', ->












