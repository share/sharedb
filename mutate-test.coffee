# Test that operations apply to their documents correctly.

type = require('./mutate')

module.exports =
  setUp: (callback) ->
    @lookup = type._lookup
    @create = type.create
    @apply = type.apply
    callback()

  'name is json-racer': (test) ->
    test.strictEqual type.name, 'json-racer'
    test.done()

  'create returns null': (test) ->
    test.strictEqual @create(), null
    test.done()

  'lookup':
    'regular decents': (test) ->
      {elem, key} = @lookup null, []
      test.strictEqual null, elem[key]

      # Value isn't created.
      test.equal null, (@lookup null, ['x'], false).elem
      test.equal null, (@lookup null, [0], false).elem

      # Root of the document is created as an empty object to contain the value
      {root, elem, key} = @lookup null, ['x'], true
      test.deepEqual elem, {}
      test.strictEqual key, 'x'
      test.strictEqual root, elem

      # Root of the document is created as an empty array
      {root, elem, key} = @lookup null, [0], true
      test.deepEqual elem, []
      test.strictEqual key, 0
      test.strictEqual root, elem

      {root, elem, key} = @lookup null, ['x', 'y', 'z'], true
      test.deepEqual elem, {}
      test.deepEqual root, {x:{y:elem}}
      test.strictEqual key, 'z'

      test.done()

    'Error cases': (test) ->
      test.throws -> @lookup 5, ['x']
      test.throws -> @lookup 5, [2]
      test.throws -> @lookup {x:{}}, ['x', 5]
      test.throws -> @lookup {x:[]}, ['x', 'y']
      test.done()

  'simple errors':
    'invalid ops': (test) ->
      test.throws -> @apply null
      test.throws -> @apply null, 'hi'
      test.throws -> @apply null, 123
      test.done()

    'no path': (test) ->
      test.throws -> @apply null, {op:'set', val:'x'}
      test.done()

  'set':
    'simple apply': (test) ->
      test.deepEqual 'hi', @apply null, op:'set', p:[], val:'hi'
      test.deepEqual 'hi', @apply {x:5}, op:'set', p:[], val:'hi'
      test.deepEqual {x:5, v:'hi'}, @apply {x:5}, op:'set', p:['v'], val:'hi'
      test.deepEqual [1, 100, 3], @apply [1,2,3], op:'set', p:[1], val:100
      test.done()

    'deep set in nonexistant object': (test) ->
      test.deepEqual {x:5}, @apply null, op:'set', p:['x'], val:5
      test.deepEqual {x:{y:5}}, @apply {}, op:'set', p:['x','y'], val:5
      test.deepEqual {x:{y:5}}, @apply {}, op:'set', p:['x','y'], val:5

      test.deepEqual [5], @apply null, op:'set', p:[0], val:5
      test.deepEqual [1,2,3,4], @apply [1,2,3], op:'set', p:[3], val:4
      test.deepEqual {x:[5]}, @apply {}, op:'set', p:['x', 0], val:5
      test.done()

    'paths are created': (test) ->
      test.deepEqual {x:'hi'}, @apply null, op:'set', p:['x'], val:'hi'
      test.deepEqual {x:['hi']}, @apply {}, op:'set', p:['x', 0], val:'hi'
      test.done()

  'setNull': (test) ->
    test.deepEqual 'hi', @apply null, op:'setNull', p:[], val:'hi'
    test.deepEqual {x:5}, @apply {x:5}, op:'setNull', p:[], val:'hi'
    test.deepEqual {x:5, v:'hi'}, @apply {x:5}, op:'setNull', p:['v'], val:'hi'
    test.deepEqual {x:5, v:'xxx'}, @apply {x:5, v:'xxx'}, op:'setNull', p:['v'], val:'hi'
    test.deepEqual [1, 2, 3], @apply [1,2,3], op:'setNull', p:[1], val:100
    test.deepEqual [1, 2, 3, 4], @apply [1,2,3], op:'setNull', p:[3], val:4
    test.deepEqual {x:{y:5}}, @apply {}, op:'setNull', p:['x','y'], val:5
    test.done()

  'insert': (test) ->
    # Shouldn't be able to insert into an object
    test.throws -> @apply {}, op:'ins', p:['x'], val:5
    test.deepEqual [5], @apply [], op:'ins', p:[0], val:5
    test.deepEqual [5], @apply null, op:'ins', p:[0], val:5
    test.deepEqual [1,2,3], @apply [1,3], op:'ins', p:[1], val:2
    test.deepEqual [1,2,3], @apply [1,2], op:'ins', p:[2], val:3
    test.deepEqual [1,2,3], @apply [1,2], op:'ins', p:[-1], val:3
    test.deepEqual [1,2,3], @apply [2,3], op:'ins', p:[0], val:1

    # Make sure the object chain gets created
    test.deepEqual {x:y:[2]}, @apply null, op:'ins', p:['x', 'y', 0], val:2

    test.done()

  'remove': (test) ->
    test.deepEqual {x:{}}, @apply {x:{y:5}}, op:'rm', p:['x', 'y']
    test.deepEqual [1,2,3], @apply [1,2,3,4], op:'rm', p:[3]
    test.deepEqual [1,2,3], @apply [1,2,3,4], op:'rm', p:[-1]
    test.deepEqual [1,2], @apply [1,2,3,4], op:'rm', p:[2], count:2 # remove from end
    test.deepEqual [1,2], @apply [1,2,3,4], op:'rm', p:[2], count:10000 # Extra count ignored
    test.deepEqual [1,4], @apply [1,2,3,4], op:'rm', p:[1], count:2 # remove in middle
    test.deepEqual [1,2], @apply [1,2,3,4], op:'rm', p:[-1], count:2 # remove from the end
    test.deepEqual [], @apply [1,2,3,4], op:'rm', p:[-1], count:20000 # remove heaps from the end

    test.deepEqual {x:[1,2,3]}, @apply {x:[1,2,3,4]}, op:'rm', p:['x', 3]
    test.deepEqual {x:[1,2,3]}, @apply {x:[1,2,3,4]}, op:'rm', p:['x', -1]

    # If there's nothing to remove, do nothing.
    test.deepEqual null, @apply null, op:'rm', p:['x', 'y']
    test.deepEqual {}, @apply {}, op:'rm', p:['x', 'y']
    test.deepEqual {x:{}}, @apply {x:{}}, op:'rm', p:['x', 'y']

    test.done()

  'ins': (test) ->
    test.deepEqual ['hi'], @apply [], op:'ins', p:[0], val:'hi'
    test.deepEqual ['hi', 'there'], @apply [], op:'ins', p:[0], vals:['hi', 'there']
    test.deepEqual ['hi', 'there'], @apply ['hi'], op:'ins', p:[1], val:'there'
    test.deepEqual ['hi', 'there'], @apply ['hi'], op:'ins', p:[-1], val:'there'
    test.deepEqual ['hi', 'there'], @apply ['there'], op:'ins', p:[0], val:'hi'

    test.deepEqual {x:['hi']}, @apply {x:[]}, op:'ins', p:['x', 0], val:'hi'

    test.deepEqual {x:['hi']}, @apply null, op:'ins', p:['x', 0], val:'hi'
    test.deepEqual {x:['hi']}, @apply null, op:'ins', p:['x', 100], val:'hi'

    test.done()
  
