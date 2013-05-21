
module.exports = (options) ->

  name: 'my cool db backend'

  submit: (cName, docName, opData, snapshot, callback) ->
    console.log "set snapshot for #{cName} to ", snapshot
    callback()

  
  subscribedChannels: (cName, query, opts) -> ['internet', 'forceSOLR']

  query: (cName, query, callback) ->
    console.log 'running query'
    callback null, results:[], extra:(new Date()).getSeconds()

    # or simply:
    #callback null, []



