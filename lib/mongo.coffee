# A super simple mongodb adapter for itsalive

# mongo is a mongoskin client. Create with:
#  mongo.db('localhost:27017/tx?auto_reconnect', safe:true)
module.exports = (mongo) ->
  getSnapshot: (cName, docName, callback) ->
    throw new Error 'db already closed' if @closed
    mongo.collection(cName).findOne {_id:docName}, callback

  setSnapshot: (cName, docName, v, doc, callback) ->
    throw new Error 'db already closed' if @closed
    mongo.collection(cName).update {_id:docName}, {$set:{v:v, data:doc}}, {upsert:true}, callback

  query: (cName, query, callback) ->
    throw new Error 'db already closed' if @closed
    mongo.collection(cName).query query, callback

  close: ->
    throw new Error 'db already closed' if @closed
    mongo.close()
    @closed = true
