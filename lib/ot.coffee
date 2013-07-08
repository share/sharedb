# This contains the master OT functions for the database. They look like ot-types style operational transform
# functions, but they're a bit different. These functions understand versions and can deal with out of bound
# create & delete operations.

otTypes = require 'ottypes'
async = require 'async'

exports.normalize = (opData) ->
  if opData.create
    # We should store the full URI of the type, not just its short name
    opData.create.type = otTypes[opData.create.type].uri

# Returns an error string on failure.
exports.checkOpData = (opData) ->
  return 'Missing opData' unless typeof opData is 'object'
  return 'Missing op1' if typeof (opData.op or opData.create) isnt 'object' and opData.del isnt true
  return 'Missing create type' if opData.create and typeof opData.create.type isnt 'string'

  return 'Invalid src' if opData.src? and typeof opData.src isnt 'string'
  return 'Invalid seq' if opData.seq? and typeof opData.seq isnt 'number'
  return 'seq but not src' if !!opData.seq isnt !!opData.src

defaultValidate = (opData, data, callback) ->
  callback()

# This is the super apply function that takes in snapshot data (including the type) and edits it in-place.
# Returns an error string or null for success.
exports.apply = (data, opData, callback) ->
  #console.log 'apply', data, opData
  return callback 'Missing data' unless typeof opData is 'object'
  return callback 'Missing op' unless typeof (opData.op or opData.create) is 'object' or opData.del is true

  return callback 'Version mismatch' if data.v? && opData.v? and data.v != opData.v

  validate = opData.validate or defaultValidate
  preValidate = opData.preValidate or defaultValidate

  if opData.create
    return callback 'Document already exists' if data.type

    # The document doesn't exist, although it might have once existed. Here we will only allow creates.
    create = opData.create

    type = otTypes[create.type]
    return callback "Type not found" unless type

    preValidate opData, data, (err) ->

      return callback err if err

      snapshot = type.create create.data

      data.data = snapshot
      data.type = type.uri
      data.v++

      validate opData, data, (err) ->
        return callback err, data

  else if opData.del
    preValidate opData, data, (err) ->
      return callback err if err

      opData.prev = {data:data.data, type:data.type}
      delete data.data
      delete data.type
      data.v++

      validate opData, data, (err) ->
        return callback err, data

  else
    return callback 'Document does not exist' unless data.type
    # Apply the op data
    op = opData.op
    return callback 'Missing op' unless typeof op is 'object'
    type = otTypes[data.type]
    return callback 'Type not found' unless type

    #try
    atomicOps = if type.shatter then type.shatter op else [op]

    series = []

    for atom in atomicOps
      # kinda dodgy.
      opData.op = atom

      series.push (cb) ->
        preValidate opData, data, cb

    async.series series, (err, results) ->
      return callback err if err

      for atom in atomicOps

        opData.op = atom

        data.data = type.apply data.data, atom

        series.push (cb) ->
          validate opData, data, cb

        async.series series, (err, results) ->
          return callback err if err

          # Make sure to restore the original operation before we return.
          opData.op = op

          data.v++

          callback()

    #catch e
    #  console.log e.stack
    #  return e.message


exports.transform = (type, opData, appliedOpData) ->
  return 'Document was deleted' if appliedOpData.del
    
  return 'Document created remotely' if appliedOpData.create # type will be null / undefined in this case.

  return 'Document does not exist' unless type

  if typeof type is 'string'
    type = otTypes[type]
    return "Type not found" unless type

  opData.op = type.transform opData.op, appliedOpData.op, 'left'
  opData.v++

  return


