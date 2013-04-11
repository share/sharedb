# A super simple mongodb adapter for itsalive

# mongo is a mongoskin client. Create with:
#  mongo.db('localhost:27017/tx?auto_reconnect', safe:true)
module.exports = (args...) ->
  mongo = require('mongoskin').db args...
  
  create: (cName, docName, data, callback) ->
    data._id = docName
    mongo.collection(cName).insert data, callback

  close: ->
    throw new Error 'db already closed' if @closed
    mongo.close()
    @closed = true

  getSnapshot: (cName, docName, callback) ->
    throw new Error 'db already closed' if @closed
    mongo.collection(cName).findOne {_id:docName}, (err, data) ->
      delete data._id if data
      callback err, data

  setSnapshot: (cName, docName, data, callback) ->
    throw new Error 'db already closed' if @closed
    data.data = null if data.data is undefined
    data.type = null if data.type is undefined
    mongo.collection(cName).update {_id:docName}, {$set:data}, {upsert:true}, callback

  query: (cName, query, callback) ->
    return callback 'query cannot specify a document ID' if query._id
    return callback 'db already closed' if @closed
    mongo.collection(cName).find({data:query}).toArray (err, results) ->
      try
        callback err, results
      catch e
        console.log e.stack
        throw e


  queryDoc: (cName, docName, query, callback) ->
    query = JSON.parse JSON.stringify query # clone the query so we don't edit the original
    mongo.collection(cName).findOne {_id:docName, data:query}, (err, result) ->
      delete result._id if result
      callback err, result

  # Test whether an operation will make the document its applied to match the specified query.
  # This function doesn't really have enough information to know in all cases, but if we can determine
  # whether a query matches based on just the operation, it saves doing extra DB calls. 
  #
  # currentStatus is true or false depending on whether the query currently matches.
  # return true or false if it knows, or null if the function doesn't have enough information to tell.
  willOpMakeDocMatchQuery: (currentStatus, query, op) -> null


  # Test if a document matches a particular query. Should be synchronous and return true or false.
  #matchesQuery: null # (query, doc) ->

