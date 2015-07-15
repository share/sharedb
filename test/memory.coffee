Memory = require('../lib/memory')

describe 'memory db', ->
  create = (callback) ->
    callback new Memory()
  require('./snapshotdb') create
  require('./oplog') create
