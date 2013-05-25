# A super simple mongodb adapter for livedb

shallowClone = (object) ->
  out = {}
  out[key] = object[key] for key of object
  return out

metaOperators =
  $comment: true
  $explain: true
  $hint: true
  $maxScan: true
  $max: true
  $min: true
  $orderby: true
  $returnKey: true
  $showDiskLoc: true
  $snapshot: true

cursorOperators =
  $skip: 'skip'
  $limit: 'limit'

extractCursorMethods = (query) ->
  out = []
  for key of query
    if cursorOperators[key]
      out.push [cursorOperators[key], query[key]]
      delete query[key]
  return out

normalizeQuery = (inputQuery) ->
  # Box queries inside of a $query and clone so that we know where to look
  # for selctors and can modify them without affecting the original object
  if inputQuery.$query
    query = shallowClone inputQuery
    query.$query = shallowClone query.$query
  else
    query = {$query: {}}
    for key, value of inputQuery
      if metaOperators[key] || cursorOperators[key]
        query[key] = value
      else
        query.$query[key] = value

  # Deleted documents are kept around so that we can start their version from
  # the last version if they get recreated. When they are deleted, their type
  # is set to null, so don't return any documents with a null type.
  query.$query._type = {$ne: null} unless query.$query._type

  return query

castToDoc = (docName, data) ->
  doc = if typeof data.data is 'object' && data.data isnt null && !Array.isArray(data.data)
    data.data
  else
    _data: if data.data? then data.data else null
  doc._type = data.type || null
  doc._v = data.v
  doc._id = docName
  return doc

castToSnapshot = (doc) ->
  return unless doc
  type = doc._type
  v = doc._v
  docName = doc._id
  data = doc._data
  if data is undefined
    delete doc._type
    delete doc._v
    delete doc._id
    return {
      data: doc
      type: type
      v: v
      docName: docName
    }
  return {
    data: data
    type: type
    v: v
    docName: docName
  }

# mongo is a mongoskin client. Create with:
#  mongo.db('localhost:27017/tx?auto_reconnect', safe:true)
module.exports = (args...) ->
  mongo = require('mongoskin').db args...
  
  name: 'mongo'

  close: ->
    return callback 'db already closed' if @closed
    mongo.close()
    @closed = true

  getSnapshot: (cName, docName, callback) ->
    return callback 'db already closed' if @closed
    mongo.collection(cName).findOne {_id:docName}, (err, doc) ->
      callback err, castToSnapshot(doc)

  setSnapshot: (cName, docName, data, callback) ->
    return callback 'db already closed' if @closed
    doc = castToDoc docName, data
    mongo.collection(cName).update {_id:docName}, doc, {upsert:true}, callback

  query: (cName, inputQuery, callback) ->
    return callback 'db already closed' if @closed

    query = normalizeQuery inputQuery
    cursorMethods = extractCursorMethods query

    mongo.collection(cName).find query, (err, cursor) ->
      return callback err if err

      for item in cursorMethods
        cursor[item[0]] item[1]

      cursor.toArray (err, results) ->
        results = results && results.map(castToSnapshot)
        callback err, results

  queryDoc: (index, cName, docName, inputQuery, callback) ->
    return callback 'db already closed' if @closed
    query = normalizeQuery inputQuery

    if query.$query._id
      return callback() if query.$query._id isnt docName
    else
      query.$query._id = docName

    mongo.collection(cName).findOne query, (err, doc) ->
      callback err, castToSnapshot(doc)

  # Test whether an operation will make the document its applied to match the specified query.
  # This function doesn't really have enough information to know in all cases, but if we can determine
  # whether a query matches based on just the operation, it saves doing extra DB calls. 
  #
  # currentStatus is true or false depending on whether the query currently matches.
  # return true or false if it knows, or null if the function doesn't have enough information to tell.
  willOpMakeDocMatchQuery: (currentStatus, query, op) -> null

  # Does the query need to be rerun against the database with every edit?
  queryNeedsPollMode: (query) ->
    query.$orderby || query.$limit || query.$skip

  # Test if a document matches a particular query. Should be synchronous and return true or false.
  #matchesQuery: null # (query, doc) ->
