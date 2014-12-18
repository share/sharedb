# This used to be the whole set of tests - now some of the ancillary parts of
# livedb have been pulled out. These tests should probably be split out into
# multiple files.

livedb = require '../lib'
assert = require 'assert'
Q = require 'q'
inProcessDriver = require '../lib/inprocessdriver'
TestDriver = require './testdriver'

textType = require('ot-text').type
{createClient, setup, teardown, stripTs} = require './util'

describe 'queue', ->
  beforeEach setup

  beforeEach ->
    @cName = '_test'
    @docName2 = 'id1'

  afterEach teardown

  it 'queues consecutive operations when they are not commited', (done) -> @create =>
    # TODO noansknv Assert all operations submitted.
    client = createClient @db, (db) -> new TestDriver db

    # TODO noansknv use consistently #15 in redis
    client.driver.redis.flushdb()

    # TODO noansknv: Refactor this monstrocity
    @create2 @docName2

    # A submits 's1A' then 's2A', delay happens and it doesn't get sent to redis.
    # B submits 's1B' and is sent to redis immediately. 's2A' is sent to redis and
    # transformation is needed for 's1A' but per-useragent seq for A is wrong and
    # client is informed that 'Op already submitted'.
    client.client.submit @cName, @docName, v:1, op:["s1A"], seq:1, src: 'A', { redisSubmitDelay: 150 }, (err) ->
      throw new Error err if err
      done()

    client.client.submit @cName, @docName2, v:1, op:["s2A"], seq: 1, src: 'A', { redisSubmitDelay: 50 }, (err) ->
      throw new Error err if err

    client.client.submit @cName, @docName, v:1, op:["s1B"], seq: 1, src: 'B', (err) =>
      throw new Error err if err

  it 'queues up operations per-client until the front of the queue is acknowledged', (done) -> @create =>
    client = createClient @db, (db) -> new TestDriver db

    # TODO noansknv use consistently #15 in redis
    client.driver.redis.flushdb()

    op1 =
      cName: @cName
      docName: @docName
      opData:
        docName: @docName
        v: 1
        op: ["op1"]
        seq: 1
        src: "A"
        m:{}

    op2 =
      cName: @cName
      docName: @docName
      opData:
        docName: @docName
        v: 2
        op: ["op2"]
        seq: 2
        src: "A"
        m:{}

    client.client.submit @cName, @docName, v:1, op: ["op1"], seq:1, src: "A", { redisSubmitDelay: 150 }, (err) =>
      throw new Error err if err

    client.client.driver.operationAssert undefined

    client.client.submit @cName, @docName, v:2, op: ["op2"], seq:2, src: "A", { redisSubmitDelay: 0 }, (err) =>
      throw new Error err if err

      client.client.driver.operationAssert [op1, op2]

      done()

    client.client.driver.operationAssert undefined
