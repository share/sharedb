# This fires the tests for the redis driver
redisLib = require 'redis'

runTests = require './driver'

describe 'redis driver', ->
  # redisLib.createClient().eval """redis.log(redis.LOG_WARNING, '--------------')""", 0, ->
  create = (oplog) ->
    createDriver = require '../lib/redisdriver'
    redis = redisLib.createClient()
    redis.select redis.selected_db = 15
    return createDriver oplog, redis

  destroy = (driver) ->
    driver.destroy()
    driver.redis.quit()

  beforeEach (done) ->
    c = redisLib.createClient()
    c.select 15
    # console.log '********   f ->'
    c.flushdb (err) ->
      throw Error err if err
      # console.log '********   f <-'
      c.quit()
      done()

  runTests create, destroy, yes


  # describe 'subscribe', ->
  #   it 'has no dangling listeners after subscribing and unsubscribing', (done) ->
  #     @subscribe 'users', @docName, 0, (err, stream) =>
  #       stream.destroy()

  #       redis = redisLib.createClient()
  #       # I want to count the number of subscribed channels. Redis 2.8 adds
  #       # the 'pubsub' command, which does this. However, I can't rely on
  #       # pubsub existing so I'll use a dodgy method.
  #       #redis.send_command 'pubsub', ['CHANNELS'], (err, channels) ->
  #       redis.publish "15 #{@cName}.#{@docName}", '{}', (err, numSubscribers) ->
  #         assert.equal numSubscribers, 0
  #         redis.quit()
  #         done()
