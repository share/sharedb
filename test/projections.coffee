
livedb = require '../lib'
assert = require 'assert'
{normalizeType} = require '../lib/ot'
json0 = normalizeType 'json0'

{setup, teardown, stripOps} = require './util'

{projectSnapshot, projectOpData, isSnapshotAllowed, isOpDataAllowed} = require '../lib/projections'

read = (stream, callback) ->
  d = stream.read()
  return callback null, d if d?

  stream.once 'end', endListener = ->
    callback 'Stream ended before reading finished'

  stream.once 'readable', ->
    stream.removeListener 'end', endListener
    d = stream.read()
    if d?
      callback null, d
    else
      callback 'Stream ended before reading finished'

readN = (stream, n, callback) ->
  buffer = []
  more = (err, data) ->
    return callback err if err

    buffer.push data
    if buffer.length is n
      return callback null, buffer

    read stream, more

  if n is 0
    callback null, []
  else
    read stream, more

describe 'stream utility methods', ->
  {Readable} = require 'stream'

  beforeEach ->
    @s = new Readable {objectMode:true}
    @s._read = ->

  it 'works asyncronously', (done) ->
    @s.push 'hi'
    @s.push 'there'
    readN @s, 3, (err, data) ->
      throw Error err if err
      assert.deepEqual data, ['hi', 'there', 'floof']
      done()

    setTimeout =>
      @s.push 'floof'
      @s.push null
    , 10


describe 'projection utility methods', ->
  describe 'projectSnapshot', ->
    it 'filters properties', ->
      test = (fields, snapshot, expected) ->
        projectSnapshot fields, snapshot
        assert.deepEqual snapshot, expected

      test {}, {type:json0}, {type: json0}
      test {}, {type:json0, data:{}}, {type:json0, data:{}}
      test {}, {type:json0, data:{a:2}}, {type:json0, data:{}}
      test {x:true}, {type:json0, data:{x:2}}, {type:json0, data:{x:2}}
      test {x:true}, {type:json0, data:{x:[1,2,3]}}, {type:json0, data:{x:[1,2,3]}}
      test {x:true}, {type:json0, data:{a:2, x:5}}, {type:json0, data:{x:5}}

      test {x:true}, {type:json0, data:[]}, {type:json0, data:null}
      test {x:true}, {type:json0, data:4}, {type:json0, data:null}
      test {x:true}, {type:json0, data:'hi'}, {type:json0, data:null}

  describe 'projectOpData', ->
    it 'passes src/seq into the projected op', ->
      op = {src:'src', seq:123, op:[]}
      assert.deepEqual op, projectOpData({}, op)

    describe 'op', ->
      beforeEach ->
        @op = (fields, input, expected = input) ->
          assert.deepEqual {op:expected}, projectOpData(fields, {op:input})

      it 'filters components on the same level', ->
        @op {}, []
        @op {}, [{p:['x'], na:1}], []
        @op {x:true}, [{p:['x'], na:1}]
        @op {y:true}, [{p:['x'], na:1}], []
        @op {x:true, y:true}, [{p:['x'], od:2, oi:3}, {p:['y'], na:1}]

      it 'filters root ops', ->
        @op {}, [p:[], od:{a:1, x:2}, oi:{x:3}], [p:[], od:{}, oi:{}]
        @op {x:true}, [p:[], od:{a:1, x:2}, oi:{x:3}], [p:[], od:{x:2}, oi:{x:3}]
        @op {x:true}, [p:[], od:{a:1, x:2}, oi:{z:3}], [p:[], od:{x:2}, oi:{}]
        @op {x:true, a:true, z:true}, [p:[], od:{a:1, x:2}, oi:{z:3}]

        # If you make the document something other than an object, it just looks like null.
        @op {x:true}, [p:[], od:{a:2, x:5}, oi:[]], [p:[], od:{x:5}, oi:null]

        @op {x:true}, [p:[], na:5], []

      it 'allows editing in-property fields', ->
        @op {}, [p:['x', 'y'], na:1], []
        @op {x:true}, [p:['x', 'y'], na:1]
        @op {x:true}, [p:['x'], na:1]
        @op {y:true}, [p:['x', 'y'], na:1], []

    describe 'create', ->
      it 'does not tell projections about operations that create the doc with the wrong type', ->
        assert.deepEqual {}, projectOpData {x:true}, {create:{type:'other'}}
        assert.deepEqual {}, projectOpData {x:true}, {create:{type:'other', data:123}}

      it 'strips data in creates', ->
        assert.deepEqual {create:{type:json0, data:{x:10}}},
            projectOpData {x:true}, {create:{type:json0, data:{x:10}}}
        assert.deepEqual {create:{type:json0, data:{}}},
            projectOpData {x:true}, {create:{type:json0, data:{y:10}}}

    describe 'isSnapshotAllowed', ->
      it 'returns true iff projectSnapshot returns the original object', ->
        test = (fields, snapshot) ->
          previous = snapshot.data
          if isSnapshotAllowed fields, snapshot
            projectSnapshot fields, snapshot
            assert.deepEqual snapshot.data, previous
          else
            projectSnapshot fields, snapshot
            assert.notDeepEqual snapshot.data, previous

        test {x:true}, {type:json0, data:{x:5}}
        test {}, {type:json0, data:{x:5}}
        test {x:true}, {type:json0, data:{x:{y:true}}}
        test {y:true}, {type:json0, data:{x:{y:true}}}
        test {x:true}, {type:json0, data:{x:4, y:6}}

      it 'returns false for any non-object thing', ->
        assert.strictEqual false, isSnapshotAllowed {}, {type:json0, data:null}
        assert.strictEqual false, isSnapshotAllowed {}, {type:json0, data:3}
        assert.strictEqual false, isSnapshotAllowed {}, {type:json0, data:[]}
        assert.strictEqual false, isSnapshotAllowed {}, {type:json0, data:'hi'}

    describe 'isOpDataAllowed', ->
      it 'works with create ops', ->
        assert.equal true, isOpDataAllowed null, {}, {create:{type:json0}}
        assert.equal true, isOpDataAllowed null, {x:true}, {create:{type:json0}}
        assert.equal false, isOpDataAllowed null, {x:true}, {create:{type:"something else"}}

        assert.equal true, isOpDataAllowed null, {x:true}, {create:{type:json0, data:{}}}
        assert.equal true, isOpDataAllowed null, {x:true}, {create:{type:json0, data:{x:5}}}
        assert.equal false, isOpDataAllowed null, {x:true}, {create:{type:json0, data:{y:5}}}

      it 'works with del ops', ->
        # Del should always be allowed.
        assert.equal true, isOpDataAllowed null, {}, {del:true}

      it 'works with ops', ->
        test = (expected, fields, op, type = json0) ->
          assert.equal expected, isOpDataAllowed type, fields, {op:op}

        test true, {x:true}, [p:['x'], na:1]
        test false, {y:true}, [p:['x'], na:1]
        test false, {}, [p:['x'], na:1]
        test false, {x:true}, [{p:['x'], na:1}, {p:['y'], na:1}]

        test false, {x:true}, [p:[], oi:{}]


describe 'projections', ->
  beforeEach setup

  beforeEach ->
    @proj = '_proj'
    @client.addProjection @proj, @cName, 'json0', {x:true, y:true, z:true}

  afterEach teardown

  describe 'fetch', ->
    it 'returns projected data through fetch()', (done) -> @create {a:1, b:false, x:5, y:false}, =>
      @client.fetch @proj, @docName, (err, snapshot) ->
        assert.deepEqual snapshot.data, {x:5, y:false}
        done()

  describe 'ops', ->
    it 'filters ops from getOps', (done) -> @create {a:1, x:{}, y:2}, =>
      # This op should be a nice interesting mix of things, but this is not exhaustive. There are
      # other tests to make sure that projected ops work correctly.
      op = [{p:['b'], oi:3}, {p:['y'], na:1}, {p:['z'], oi:4}, {p:['x', 'seph'], oi:'super'}]

      @client.submit @cName, @docName, v:1, op:op, (err, v) =>
        throw Error err if err
        @client.getOps @proj, @docName, 0, 2, (err, ops) =>
          throw Error err if err
          stripOps ops

          assert.equal ops.length, 2
          assert.deepEqual ops[0], {v:0, create:{type:json0, data:{x:{}, y:2}}, src:''}
          assert.deepEqual ops[1], {v:1, op:[{p:['y'], na:1}, {p:['z'], oi:4}, {p:['x', 'seph'], oi:'super'}], src:''}

          done()

    it 'filters ops through subscriptions', (done) -> @create {a:1, x:2, y:2}, =>
      @client.submit @cName, @docName, v:1, op:[{p:['x'], na:1}, {p:['a'], na:1}], (err) =>
        throw Error err if err
        @client.subscribe @proj, @docName, 0, (err, stream) =>
          throw Error err if err
          @client.submit @cName, @docName, v:2, op:[{p:['y'], na:1}, {p:['a'], na:1}], (err) =>
            expected = [
              {v:0, create:{type:json0, data:{x:2, y:2}}, src:''}
              {v:1, op:[{p:['x'], na:1}], src:''}
              {v:2, op:[{p:['y'], na:1}], src:''}
            ]
            readN stream, 3, (err, data) =>
              stripOps data
              assert.deepEqual data, expected
              stream.destroy()
              @client.driver._checkForLeaks false, done

    it 'filters ops through bulk subscriptions', (done) ->
      @createDoc 'one', {a:1, x:2, y:3}, => @createDoc 'two', {a:1, x:2, y:3}, =>

        req = {}
        req[@cName] = {one:0, two:1}
        req[@proj] = {one:0, two:1}

        @client.bulkSubscribe req, (err, result) =>
          throw Error err if err

          n = 4
          passPart = -> done() if --n is 0

          expectOp = (stream, expected) ->
            read stream, (err, op) ->
              op = stripOps op
              delete op.docName
              assert.deepEqual op, expected
              passPart()

          expectOp result[@cName].one, {v:0, create:{type:json0, data:{a:1, x:2, y:3}}, src:''}
          expectOp result[@proj].one, {v:0, create:{type:json0, data:{x:2, y:3}}, src:''}
          expectOp result[@cName].two, {v:1, op:[{p:['a'], na:1}], src:''}
          expectOp result[@proj].two, {v:1, op:[], src:''}

          @client.submit @cName, 'two', op:[{p:['a'], na:1}]

    it 'does not modify the request in a bulkSubscribe when there are projections', (done) ->
      # regression
      @createDoc 'one', {a:1, x:2, y:3}, => @createDoc 'two', {a:1, x:2, y:3}, =>

        req = {}
        req[@cName] = {one:0, two:1}
        req[@proj] = {one:0, two:1}

        reqAfter = JSON.parse JSON.stringify req

        @client.bulkSubscribe req, (err, result) =>
          assert.deepEqual req, reqAfter
          done()

    it 'does not leak memory when bulk subscribing', (done) ->
      @createDoc 'one', {a:1, x:2, y:3}, => @createDoc 'two', {a:1, x:2, y:3}, =>

        req = {}
        req[@cName] = {one:0, two:1}
        req[@proj] = {one:0, two:1}

        @client.bulkSubscribe req, (err, result) =>
          throw Error err if err
          stream.destroy() for _,stream of result[@cName]
          stream.destroy() for _,stream of result[@proj]

          @client.driver._checkForLeaks false, done


  describe 'submit', ->
    it 'rewrites submit on a projected query to apply to the original collection', (done) ->
      realOps = [
        {create:{type:json0, data:{x:1}}, v:0, src:'src', seq:1}
        {v:1, op:[{p:['x'], na:1}], v:1, src:'src', seq:2}
        {del:true, v:2, src:'src2', seq:1}
      ]

      @client.subscribe @proj, @docName, 0, (err, projStream) =>
        throw Error err if err
        @client.subscribe @cName, @docName, 0, (err, origStream) =>
          throw Error err if err

          @client.submit @proj, @docName, realOps[0], (err) =>
            throw Error err if err
            @client.submit @proj, @docName, realOps[1], (err) =>
              throw Error err if err
              @client.submit @proj, @docName, realOps[2], (err) =>
                throw Error err if err

                readN projStream, 3, (err, ops) =>
                  throw Error err if err
                  stripOps ops
                  stripOps realOps
                  assert.deepEqual ops, realOps

                  readN origStream, 3, (err, ops) =>
                    throw Error err if err
                    stripOps ops
                    stripOps realOps
                    assert.deepEqual ops, realOps

                    done()

    it 'does not allow op submit outside of the projection', (done) ->
      # Both of these ops won't be allowed in the projection.
      checkSubmitFails = (op, cb) =>
        v = op.v

        @client.submit @proj, @docName, op, (err) =>
          assert.ok err

          @client.getOps @proj, @docName, v, null, (err, ops) =>
            throw Error err if err
            assert.equal ops.length, 0

            @client.getOps @cName, @docName, v, null, (err, ops) =>
              throw Error err if err
              assert.equal ops.length, 0

              cb()

      checkSubmitFails {create:{type:json0, data:{a:1}}, v:0}, =>
        # Now try again with a normal op. We have to first @create.
        @create {a:1}, =>
          checkSubmitFails {v:1, op:[{p:['a'], na:1}], v:1}, =>
            done()


  describe 'queries', ->
    it 'does not return any results in the projected collection if its empty', (done) ->
      @client.queryFetch @proj, null, {}, (err, results) ->
        throw Error err if err
        assert.deepEqual results, []
        done()

    it 'projects data returned by queryFetch', (done) ->
      @createDoc 'aaa', {a:5, x:3}, => @createDoc 'bbb', {x:3}, => @createDoc 'ccc', {}, =>
        @client.queryFetch @proj, null, {}, (err, results) =>
          throw Error err if err
          results.sort (a, b) -> if b.docName > a.docName then -1 else 1
          delete result.m for result in results

          assert.deepEqual results, [
            {v:1, type:json0, docName:'aaa', data:{x:3}}
            {v:1, type:json0, docName:'bbb', data:{x:3}}
            {v:1, type:json0, docName:'ccc', data:{}}
          ]
          done()

    # Do these tests with polling turned on and off
    [false, true].forEach (poll) -> describe "poll:#{poll}", ->

      opts = {poll:poll}
      it 'projects data returned by querySubscribe', (done) ->
        @createDoc 'aaa', {a:5, x:3}, => @createDoc 'bbb', {x:3}, => @createDoc 'ccc', {}, =>
          @client.querySubscribe @proj, null, opts, (err, emitter, results) =>
            throw Error err if err

            results.sort (a, b) -> if b.docName > a.docName then -1 else 1
            delete result.m for result in results
            assert.deepEqual results, [
              {v:1, type:json0, docName:'aaa', data:{x:3}}
              {v:1, type:json0, docName:'bbb', data:{x:3}}
              {v:1, type:json0, docName:'ccc', data:{}}
            ]
            done()

      it 'projects data returned by querySubscribe in a diff', (done) ->
        @client.querySubscribe @proj, 'unused', opts, (err, emitter, results) =>
          throw Error err if err
          assert.deepEqual results, []

          emitter.onDiff = (stuff) =>
            delete stuff[0].values[0].m
            assert.deepEqual stuff, [
              index: 0
              values: [
                v:1, data:{x:5}, type:json0, docName:@docName
              ]
            ]
            done()

          @create {x:5, a:1}
