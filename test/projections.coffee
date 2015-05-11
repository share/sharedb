
livedb = require '../lib'
assert = require 'assert'
{normalizeType} = require '../lib/ot'
json0 = normalizeType 'json0'

{setup, teardown, stripTs} = require './util'

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
      assert.deepEqual {}, projectSnapshot json0, {}, {}
      assert.deepEqual {}, projectSnapshot json0, {x:true}, {}
      assert.deepEqual {}, projectSnapshot json0, {x:true}, {a:2}
      assert.deepEqual {x:2}, projectSnapshot json0, {x:true}, {x:2}
      assert.deepEqual {x:[1,2,3]}, projectSnapshot json0, {x:true}, {x:[1,2,3]}
      assert.deepEqual {x:5}, projectSnapshot json0, {x:true}, {a:2, x:5}

      assert.deepEqual null, projectSnapshot json0, {x:true}, []
      assert.deepEqual null, projectSnapshot json0, {x:true}, 4
      assert.deepEqual null, projectSnapshot json0, {x:true}, "hi"


  describe 'projectOpData', ->
    it 'passes src/seq into the projected op', ->
      op = {src:'src', seq:123, op:[]}
      assert.deepEqual op, projectOpData json0, {}, op

    describe 'op', ->
      beforeEach ->
        @op = (fields, input, expected = input) ->
          assert.deepEqual {op:expected}, projectOpData json0, fields, {op:input}

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
        assert.deepEqual {}, projectOpData json0, {x:true}, {create:{type:'other'}}
        assert.deepEqual {}, projectOpData json0, {x:true}, {create:{type:'other', data:123}}

      it 'strips data in creates', ->
        assert.deepEqual {create:{type:json0, data:{x:10}}},
            projectOpData json0, {x:true}, {create:{type:json0, data:{x:10}}}
        assert.deepEqual {create:{type:json0, data:{}}},
            projectOpData json0, {x:true}, {create:{type:json0, data:{y:10}}}

    describe 'isSnapshotAllowed', ->
      it 'returns true iff projectSnapshot returns the original object', ->
        t = (fields, data) ->
          if isSnapshotAllowed json0, fields, data
            assert.deepEqual data, projectSnapshot json0, fields, data
          else
            assert.notDeepEqual data, projectSnapshot json0, fields, data

        t {x:true}, {x:5}
        t {}, {x:5}
        t {x:true}, {x:{y:true}}
        t {y:true}, {x:{y:true}}
        t {x:true}, {x:4, y:6}

      it 'returns false for any non-object thing', ->
        assert.strictEqual false, isSnapshotAllowed json0, {}, null
        assert.strictEqual false, isSnapshotAllowed json0, {}, 3
        assert.strictEqual false, isSnapshotAllowed json0, {}, []
        assert.strictEqual false, isSnapshotAllowed json0, {}, "hi"

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
        t = (expected, fields, op, type = json0) ->
          assert.equal expected, isOpDataAllowed type, fields, {op:op}

        t true, {x:true}, [p:['x'], na:1]
        t false, {y:true}, [p:['x'], na:1]
        t false, {}, [p:['x'], na:1]
        t false, {x:true}, [{p:['x'], na:1}, {p:['y'], na:1}]

        t false, {x:true}, [p:[], oi:{}]


describe 'projections', ->
  beforeEach setup

  beforeEach ->
    @proj = '_proj'

    @client.addProjection @proj, @cName, 'json0', {x:true, y:true, z:true}

    # Override to change the default value of data
    @create = (data, cb) ->
      [data, cb] = [{}, data] if typeof data is 'function'
      @createDoc @docName, data, cb

  afterEach teardown

  describe 'fetch', ->
    it 'returns projected data through fetch()', (done) -> @create {a:1, b:false, x:5, y:false}, =>
      @client.fetch @proj, @docName, (err, snapshot) ->
        assert.deepEqual snapshot.data, {x:5, y:false}
        done()

    it 'Uses getSnapshotProjected if it exists', (done) ->
      @db.getSnapshot = -> throw Error 'db.getSnapshot should not be called'
      @db.getSnapshotProjected = (cName, docName, fields, callback) =>
        assert.equal cName, @cName
        assert.equal docName, @docName
        assert.deepEqual fields, {x:true, y:true, z:true}
        callback null, {v:1, type:normalizeType('json0'), data:{x:5}}

      @client.fetch @proj, @docName, (err, snapshot) ->
        assert.deepEqual snapshot.data, {x:5}
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
          stripTs ops

          assert.equal ops.length, 2
          assert.deepEqual ops[0], {v:0, create:{type:json0, data:{x:{}, y:2}}, m:{}, src:''}
          assert.deepEqual ops[1], {v:1, op:[{p:['y'], na:1}, {p:['z'], oi:4}, {p:['x', 'seph'], oi:'super'}], m:{}, src:''}

          done()

    it 'filters ops through subscriptions', (done) -> @create {a:1, x:2, y:2}, =>
      @client.submit @cName, @docName, v:1, op:[{p:['x'], na:1}, {p:['a'], na:1}], (err) =>
        throw Error err if err
        @client.subscribe @proj, @docName, 0, (err, stream) =>
          throw Error err if err
          @client.submit @cName, @docName, v:2, op:[{p:['y'], na:1}, {p:['a'], na:1}], (err) =>
            expected = [
              {v:0, m:{}, create:{type:json0, data:{x:2, y:2}}, src:''}
              {v:1, m:{}, op:[{p:['x'], na:1}], src:''}
              {v:2, m:{}, op:[{p:['y'], na:1}], src:''}
            ]
            readN stream, 3, (err, data) =>
              stripTs data
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
              op = stripTs op
              delete op.docName
              assert.deepEqual op, expected
              passPart()

          expectOp result[@cName].one, {v:0, create:{type:json0, data:{a:1, x:2, y:3}}, m:{}, src:''}
          expectOp result[@proj].one, {v:0, create:{type:json0, data:{x:2, y:3}}, m:{}, src:''}
          expectOp result[@cName].two, {v:1, op:[{p:['a'], na:1}], m:{}, src:''}
          expectOp result[@proj].two, {v:1, op:[], m:{}, src:''}

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
        {create:{type:json0, data:{x:1}}, v:0, m:{}, src:'src', seq:1}
        {v:1, op:[{p:['x'], na:1}], v:1, m:{}, src:'src', seq:2}
        {del:true, v:2, m:{}, src:'src2', seq:1}
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
                  stripTs ops
                  stripTs realOps
                  assert.deepEqual ops, realOps

                  readN origStream, 3, (err, ops) =>
                    throw Error err if err
                    stripTs ops
                    stripTs realOps
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

      checkSubmitFails {create:{type:json0, data:{a:1}}, v:0, m:{}}, =>
        # Now try again with a normal op. We have to first @create.
        @create {a:1}, =>
          checkSubmitFails {v:1, op:[{p:['a'], na:1}], v:1, m:{}}, =>
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

    it 'projects data returned my queryFetch when extra data is emitted', (done) ->
      @db.query = (liveDb, index, query, options, callback) =>
        assert.deepEqual index, @cName
        callback null,
          results: [{docName:@docName, data:{a:6, x:5}, type:json0, v:1}]
          extra: 'Extra stuff'

      @client.queryFetch @proj, null, {}, (err, results) =>
        throw Error err if err
        delete result.m for result in results
        assert.deepEqual results, [{docName:@docName, data:{x:5}, type:json0, v:1}]
        done()

    it 'uses the database projection function for queries if it exists', (done) ->
      @db.query = (a,b,c,d,e) -> throw Error 'db.query should not be called'
      @db.queryProjected = (liveDb, index, fields, query, options, callback) =>
        assert.equal liveDb, @client
        assert.equal index, @cName
        assert.deepEqual fields, {x:true, y:true, z:true}
        assert.equal query, "cool cats"
        assert.deepEqual options, {mode: 'fetch'}
        callback null, [{docName:@docName, data:{x:5}, type:json0, v:1}]

      @client.queryFetch @proj, 'cool cats', {}, (err, results) =>
        throw Error err if err
        delete result.m for result in results
        assert.deepEqual results, [{docName:@docName, data:{x:5}, type:json0, v:1}]
        done()

    # Do these tests with polling turned on and off
    [false, true].forEach (poll) -> describe "poll:#{poll}", ->

      opts = {poll:poll, pollDelay:0}
      it 'projects data returned by queryPoll', (done) ->
        @createDoc 'aaa', {a:5, x:3}, => @createDoc 'bbb', {x:3}, => @createDoc 'ccc', {}, =>
          @client.queryPoll @proj, null, opts, (err, emitter, results) =>
            throw Error err if err

            results.sort (a, b) -> if b.docName > a.docName then -1 else 1
            delete result.m for result in results
            assert.deepEqual results, [
              {v:1, type:json0, docName:'aaa', data:{x:3}}
              {v:1, type:json0, docName:'bbb', data:{x:3}}
              {v:1, type:json0, docName:'ccc', data:{}}
            ]
            done()

      it 'projects data returned by queryPoll in a diff', (done) ->
        @client.queryPoll @proj, 'unused', opts, (err, emitter, results) =>
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

    it 'calls db.queryDocProjected if it exists', (done) ->
      called = false
      @db.queryDoc = -> throw Error 'db.queryDoc should not be called'
      @db.queryDocProjected = (liveDb, index, cName, docName, fields, query, callback) =>
        called = true
        callback null, {v:1, data:{x:5}, type:json0, docName:@docName}

      @client.queryPoll @proj, 'unused', {poll:false}, (err, emitter, results) =>
        throw Error err if err
        assert.deepEqual results, []

        emitter.onDiff = (stuff) =>
          assert called
          done()

        @create {x:5, a:1}
