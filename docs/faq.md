# FAQ

## Is it possible to completely delete documents from the db?

No, it is not possible to use the ShareDB API to fully delete data. In addition, the operation log is kept forever by default.

Maintaining persistence of snapshots and ops means that ShareDB can correctly deal with all cases where ops have been removed. Permanently removing the snapshot document could result in a corrupt state in some edge cases by not maintaining the current document version, which must be incremented on each commit. As well, if you delete ops and then a client reconnects needing those ops, you will break that client and it will be unable to submit any pending changes or bring itself up to date from its current state. If your use case calls for complete deletion of operations, you'll need to ensure that no clients will ever need them again or deal with the error appropriately.

You can currently delete from your persistent datastore directly. For example, if you're using MongoDB you can delete the data by connecting to Mongo directly, not via the ShareDB API. If you do delete snapshot data, be sure that you delete not just the document snapshot but all operations associated with that document. Having operations with no corresponding snapshot would result in a corrupt state.
