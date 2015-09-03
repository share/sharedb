Memory = require('../lib/memory')

describe 'memory db', ->
  create = (callback) ->
    callback new Memory()
  require('./db') create
  require('./oplog') create
