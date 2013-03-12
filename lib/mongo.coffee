# A super simple mongodb adapter for itsalive

# mongo is a mongoskin client. Create with:
#  mongo.db('localhost:27017/tx?auto_reconnect', safe:true)
module.exports = (mongo) ->
  getSnapshot: (cName, docName, callback) ->
    mongo.collection(cName).findOne {_id:docName}, callback

  setSnapshot: (cName, docName, v, doc) ->
    mongo.collection(cName).update {_id:docName}, {$set:{v:v, data:doc}}, {upsert:true}

  query: (cName, query, callback) ->
    mongo.collection(cName).query query, callback
