# FAQ

## Is it possible to completely delete documents from the db?

No, it is not possible to use the ShareDB API to fully delete data and the op log is kept forever by default.

ShareDB should correctly deal with all cases where ops have been removed, and it will not get into a corrupt state if you delete ops or a snapshot. Of course, if you delete ops and then a client reconnects needing those ops, you will break that client and it will be unable to submit any pending changes or bring itself up to date from its current state. It is much safer to never delete any ops and, if you are going to clean up ops and/or snapshots, you'll need to ensure that no clients will never need them again or deal with the error appropriately.

If you want to permanently delete data, you can delete from your persistent datastore directly. For example, if you're using MongoDB you can delete the data by connecting to Mongo directly, not the ShareDB API. Note if you are going to delete data be sure that you clean up not just the document snapshot but all operations associated with that document.
