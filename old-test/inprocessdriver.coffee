# This runs the driver tests for the inprocess driver.

runTests = require './driver'

describe 'inprocess driver', ->
  runTests require('../lib/inprocessdriver'), (driver) -> driver.destroy()
