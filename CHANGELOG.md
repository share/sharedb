## v1.0-beta

### Breaking changes

* Add options argument to all public database adapter methods that read
  or write from snapshots or ops.

* DB methods that get snapshots or ops no longer return metadata unless
  `{metadata: true}` option is passed.

* Replace `source` argument with `options` in doc methods. Use `options.source`
  instead.

* Backend streams now write objects intead of strings.

* MemoryDB.prototype._querySync now returns `{snapshots: ..., extra: ...}`
  instead of just an array of snapshots.

### Non-breaking changes

* Add options argument to backend.submit.

* Add error codes to all errors.

* Add `'updated'` event on queries which fires on all query result changes.

* In clients, wrap errors in Error objects to they get passed through event
  emitters.

* Sanitize stack traces when sending errors to client, but log them on the
  server.

## v0.11.37

Beginning of changelog.

If you're upgrading from ShareJS 0.7 or earlier,
take a look at the [ShareJS upgrade guide](docs/upgrading-from-sharejs.md).
