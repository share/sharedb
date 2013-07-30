# Unit tests for lib/ot.js
#
# This tests to make sure it does some of the right things WRT OT.
#
# Note that there's also OT code in other livedb files. This file does not
# contain any integration tests.

assert = require 'assert'

# For the simple OT type.
{simple, text} = require 'ottypes'

ot = require '../lib/ot'

describe 'ot', ->
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

    it 'accepts valid create operations', ->
      assert.equal null, ot.checkOpData {create:{type:simple.uri}}
      assert.equal null, ot.checkOpData {create:{type:simple.uri, data:'hi there'}}

    it 'accepts valid delete operations', ->
      assert.equal null, ot.checkOpData {del:true}

    it 'accepts valid ops', ->
      assert.equal null, ot.checkOpData {op:[1,2,3]}

  describe 'normalize', ->
    it 'expands type names', ->
      opData = create:type:'simple'
      ot.normalize opData
      assert.deepEqual opData, {create:type:simple.uri}

  describe 'apply', ->
    it 'fails if the versions dont match', ->
      assert.equal 'Version mismatch', ot.apply {v:5}, {v:6, create:{type:simple.uri}}
      assert.equal 'Version mismatch', ot.apply {v:5}, {v:6, del:true}
      assert.equal 'Version mismatch', ot.apply {v:5}, {v:6, op:[]}

    it 'allows the version field to be missing', ->
      assert.equal null, ot.apply {v:5}, {create:{type:simple.uri}}
      assert.equal null, ot.apply {}, {v:6, create:{type:simple.uri}}

    describe 'create', ->
      it 'fails if the document already exists', ->
        doc = {v:6, create:{type:simple.uri}}
        assert.equal 'Document already exists', ot.apply {v:6, type:simple.uri, data:'hi'}, doc
        # The doc should be unmodified
        assert.deepEqual doc, {v:6, create:{type:simple.uri}}

      it 'creates doc data correctly when no initial data is passed', ->
        doc = {v:5}
        assert.equal null, ot.apply doc, {v:5, create:{type:simple.uri}}
        assert.deepEqual doc, {v:6, type:simple.uri, data:str:''}

      it 'creates doc data when it is given initial data', ->
        doc = {v:5}
        assert.equal null, ot.apply doc, {v:5, create:{type:simple.uri, data:'Hi there'}}
        assert.deepEqual doc, {v:6, type:simple.uri, data:str:'Hi there'}

      it.skip 'runs pre and post validation functions'
    
    describe 'del', ->
      it 'deletes the document data', ->
        doc = {v:6, type:simple.uri, data:str:'Hi there'}
        assert.equal null, ot.apply doc, {v:6, del:true}
        assert.deepEqual doc, {v:7}

      it 'still works if the document doesnt exist anyway', ->
        doc = {v:6}
        assert.equal null, ot.apply doc, {v:6, del:true}
        assert.deepEqual doc, {v:7}

    describe 'op', ->
      it 'fails if the document does not exist', ->
        assert.equal 'Document does not exist', ot.apply {v:6}, {v:6, op:[1,2,3]}

      it 'fails if the type is missing', ->
        assert.equal 'Type not found', ot.apply {v:6, type:'some non existant type'}, {v:6, op:[1,2,3]}

      it 'applies the operation to the document data', ->
        doc = {v:6, type:simple.uri, data:str:'Hi'}
        assert.equal null, ot.apply doc, {v:6, op:{position:2, text:' there'}}
        assert.deepEqual doc, {v:7, type:simple.uri, data:str:'Hi there'}

      it.skip 'shatters the operation if it can, and applies it incrementally'

  describe 'transform', ->
    it 'fails if the version is specified on both and does not match', ->
      op1 = {v:5, op:{position:10, text:'hi'}}
      op2 = {v:6, op:{position:5, text:'abcde'}}
      assert.equal 'Version mismatch', ot.transform simple.uri, op1, op2
      assert.deepEqual op1, {v:5, op:{position:10, text:'hi'}}

    it 'works if the version is only specified on the first op', ->
      op1 = {op:{position:10, text:'hi'}}
      op2 = {v:6, op:{position:5, text:'abcde'}}
      assert.equal null, ot.transform simple.uri, op1, op2
      assert.deepEqual op1, {op:{position:15, text:'hi'}}

    it 'fails if you transform an op by a delete', ->
      assert.equal 'Document was deleted', ot.transform simple.uri, {v:10, op:{}}, {v:10, del:true}

    it 'lets you transform a delete by a delete', ->
      op = del:true
      assert.equal null, ot.transform simple.uri, op, {del:true}
      assert.deepEqual op, del:true

    it 'fails if you transform a create by a create', ->
      assert.equal 'Document created remotely', ot.transform null, {v:10, create:type:simple.uri}, {v:10, create:type:simple.uri}

    # Not considering create vs delete, del vs create, etc because transform
    # shouldn't be called in those cases anyway.


