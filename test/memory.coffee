memory = require('../lib/memory')

describe 'memory db', ->
  require('./snapshotdb') memory
  require('./oplog') memory
