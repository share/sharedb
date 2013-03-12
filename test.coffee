# Nodeunit test
mongoskin = require 'mongoskin'
redis = require 'redis'

alive = require './lib'

id = 0

module.exports =
  setUp: (callback) ->
    @mongo = require('mongoskin').db 'localhost:27017/test?auto_reconnect', safe:false
    @mongo.dropCollection '_test'
    @redis = redis.createClient()
    @redis.select 15
    @redis.flushdb()

    @client = alive.client @mongo, @redis
    @collection = @client.collection '_test'
    @doc = "id#{id++}"
    @create = (cb) ->
      op = op:'set', p:[], val:{}
      @collection.submit @doc, v:0, op:op, (err, v) ->
        throw new Error err if err
        cb()
    callback()

  tearDown: (callback) ->
    @mongo.close()
    @redis.quit()
    callback()
    
  'submit a create op': (test) ->
    op = op:'set', p:[], val:'hi'
    @collection.submit @doc, v:0, op:op, (err, v) ->
      throw new Error err if err
      test.strictEqual v, 0
      test.done()

  'created documents can be fetched': (test) -> @create =>
    @collection.fetch @doc, (err, {v, data}) ->
      throw new Error err if err
      test.deepEqual data, {}
      test.strictEqual v, 1
      test.done()

  'modify a document': (test) -> @create =>
    op = op:'set', p:['a'], val:'hi'
    @collection.submit @doc, v:1, op:op, (err, v) =>
      throw new Error err if err
      @collection.fetch @doc, (err, {v, data}) =>
        throw new Error err if err
        test.deepEqual data, {a:'hi'}
        test.done()

  'remove a doc': (test) -> @create =>
    op = op:'rm', p:[]
    @collection.submit @doc, v:1, op:op, (err, v) =>
      throw new Error err if err
      @collection.fetch @doc, (err, {v, data}) =>
        throw new Error err if err
        test.equal data, null
        test.done()

  'Repeated operations are not executed': (test) -> @create =>
    op = op:'set', p:[], val:{arr:[]}
    @collection.submit @doc, v:1, op:op, (err, v) =>
      throw new Error err if err
      op = op:'ins', p:['arr', 0], val:'x'
      @collection.submit @doc, v:2, id:'abc.123', op:op, (err, v) =>
        throw new Error err if err
        @collection.submit @doc, v:2, id:'abc.123', op:op, (err, v) =>
          test.strictEqual err, 'Op already submitted'
          test.done()

