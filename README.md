# LIVE DB!

This is a database wrapper which exposes the API that realtime databases should
have.

You can submit operations (edit documents) and subscribe to documents.
Subscribing gives you a stream of all operations applied to theh given
document. You can also make queries, which give you a feed of changes in the
result set while the query is open.

Currently this is very new and only used by ShareJS. To use it, you need a snapshot database wrapper. The obvious choice is mongodb. A database wrapper for mongo is available in [share/livedb-mongo](https://github.com/share/livedb-mongo).
