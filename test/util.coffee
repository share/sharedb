redisLib = require 'redis'
livedb = require '../lib'
Memory = require '../lib/memory'

# createRedisClient = exports.createClient = (db = new Memory()) ->
#   createDriver = require '../lib/redisdriver'
#   redis = redisLib.createClient()
#   redis.select redis.selected_db = 15

#   driver = createDriver db, redis

#   testWrapper = {name:'test'}
#   client = livedb.client {db, driver, extraDbs:{test:testWrapper}}
#   {client, redis, db, testWrapper, driver}


createClient = exports.createClient = (db = new Memory()) ->
  createDriver = require '../lib/inprocessdriver'
  
  driver = createDriver db

  testWrapper = {name:'test'}
  sdc = {guage: (->), increment:(->), timing:(->)}
  client = livedb.client {db, driver, extraDbs:{test:testWrapper}, sdc}
  {client, db, testWrapper, driver}


nextId = 0

# This is a bit of a mouthful - I'm not entirely happy leaving all this stuff
# in here because its not obvious whats available to tests.
exports.setup = ->
  @cName ?= '_test'

  {@client, @redis, @db, @testWrapper, @driver} = createClient()

  # & clear redis.
  # @redis.flushdb()

  @collection = @client.collection @cName
  @docName = "id#{nextId++}"

  @create2 = (docName, data = '', cb) ->
    [data, cb] = ['', data] if typeof data is 'function'

    type = if typeof data is 'string' then 'text' else 'json0'
    @collection.submit docName, {v:0, create:{type, data}}, null, (err) ->
      throw new Error err if err
      cb?()

  # callback and data are both optional.
  @create = (data, cb) -> @create2 @docName, data, cb

exports.teardown = ->
  @client.destroy()
  @driver.destroy()
  @db.close()

exports.stripTs = (ops) ->
  if Array.isArray ops
    for op in ops
      delete op.m.ts if op.m
  else
    delete ops.m.ts if ops.m
  ops
