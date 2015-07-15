livedb = require '../lib'
Memory = require '../lib/memory'
inProcessDriver = require '../lib/inprocessdriver'

exports.createClient = createClient = (db = new Memory(), createDriver = inProcessDriver) ->
  driver = createDriver db
  testWrapper = {name:'test'}
  client = livedb.client {db, driver, extraDbs:{test:testWrapper}}
  {client, db, testWrapper, driver}

nextId = 0

# This is a bit of a mouthful - I'm not entirely happy leaving all this stuff
# in here because its not obvious whats available to tests.
exports.setup = ->
  @cName ?= '_test'

  {@client, @db, @testWrapper, @driver} = createClient()
  @docName = "id#{nextId++}"

  @createDoc = (docName, data = '', cb) =>
    [data, cb] = ['', data] if typeof data is 'function'

    type = if typeof data is 'string' then 'text' else 'json0'
    @client.submit @cName, docName, {v:0, create:{type, data}}, null, (err) =>
      throw new Error err if err
      cb?()

  # callback and data are both optional.
  @create = (data, cb) -> @createDoc @docName, data, cb

exports.teardown = ->
  @client.destroy()
  @driver.destroy()
  @db.close()

exports.stripOps = (ops) ->
  if Array.isArray ops
    for op in ops
      delete op.m
      delete op.collection
      delete op.docName
  else
    delete ops.m
    delete ops.collection
    delete ops.docName
  ops

exports.calls = (num, fn) ->
  (done) ->
    done()  if num is 0
    n = 0
    fn.call this, ->
      done()  if ++n >= num
      return
    return
