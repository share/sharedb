assert = require 'assert'
TestDriver = require './testdriver'
{createClient, setup, teardown, calls} = require './util'

describe 'queue', ->
  beforeEach setup

  beforeEach ->
    @cName = '_test'
    @docName2 = 'id1'
    @testClient = createClient @db, (db) -> new TestDriver db
    @testClient.driver.redis.select(15)
    @testClient.driver.redis.flushdb()

  afterEach teardown

  it 'queues consecutive operations when they are not commited', calls 3, (done) -> @create =>
    @createDoc @docName2
    client = @testClient.client

    # A submits 's1A' then 's2A', delay happens and it doesn't get sent to redis.
    # B submits 's1B' and is sent to redis immediately. 's2A' is sent to redis and
    # transformation is needed for 's1A' but per-useragent seq for A is wrong and
    # client is informed that 'Op already submitted'.
    @testClient.client.submit @cName, @docName, {v:1, op:['s1A'], seq:1, src: 'A', redisSubmitDelay: 50}, (err) ->
      throw new Error err if err
      done()

    @testClient.client.submit @cName, @docName2, {v:1, op:['s2A'], seq:2, src: 'A', redisSubmitDelay: 10}, (err) ->
      throw new Error err if err
      # Assert that lock is cleaned once all operations are successfully submitted.
      process.nextTick ->
        assert.deepEqual client.submitMap, {}
        done()

    @testClient.client.submit @cName, @docName, {v:1, op:['s1B'], seq:1, src: 'B'}, (err) ->
      throw new Error err if err
      done()

  it 'queues up operations per-client until the front of the queue is submitted to driver', calls 2, (done) -> @create =>
    driver = @testClient.driver

    op1 =
      cName: @cName
      docName: @docName
      opData:
        v: 1
        op: ['op1']
        seq: 1
        src: 'A'

    op2 =
      cName: @cName
      docName: @docName
      opData:
        v: 2
        op: ['op2']
        seq: 2
        src: 'A'

    assert.equal driver.opList, undefined

    @testClient.client.submit @cName, @docName, {v:1, op: ['op1'], seq:1, src:'A', redisSubmitDelay:50}, (err) ->
      throw new Error err if err
      done()

    @testClient.client.submit @cName, @docName, {v:2, op: ['op2'], seq:2, src:'A', redisSubmitDelay:0}, (err) ->
      throw new Error err if err
      operationAssert driver.opList, [op1, op2]
      done()

operationAssert = (opList, expected) ->
  assert.equal expected.length, opList.length

  for op, i in opList
    expectedOp = expected[i]
    assert.equal op.cName, expectedOp.cName
    assert.equal op.docName, expectedOp.docName
    assert.equal op.opData.v, expectedOp.opData.v
    assert.deepEqual op.opData.op, expectedOp.opData.op
    assert.equal op.opData.seq, expectedOp.opData.seq
    assert.equal op.opData.src, expectedOp.opData.src

  return
