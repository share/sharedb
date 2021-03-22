---
title: ShareDBError
layout: default
parent: API
---

# ShareDBError
{: .no_toc }

1. TOC
{:toc}

Representation of an error, with a machine-parsable [code](#error-codes).

## Properties

### `code` -- string

> A machine-parsable [code](#error-codes) representing the type of error

### `message` -- string

> A human-readable message providing more detail about the error

{: .warn }
> Consumer code should never rely on the value of `message`, which may be fragile.

## Error codes

### `ERR_OP_SUBMIT_REJECTED`

> The op submitted by the client has been rejected by the server for a non-critical reason.

> When the client receives this code, it will attempt to roll back the rejected op, leaving the client in a usable state.

> This error might be used as part of standard control flow. For example, consumers may define a middleware that validates document structure, and rejects operations that do not conform to this schema using this error code to reset the client to a valid state.

### `ERR_OP_ALREADY_SUBMITTED`

> The same op has been received by the server twice.

> This is non-critical, and part of normal control flow, and is sent as an error in order to short-circuit the op processing. It is eventually swallowed by the server, and shouldn't need further handling.

### `ERR_SUBMIT_TRANSFORM_OPS_NOT_FOUND`

> The ops needed to transform the submitted op up to the current version of the snapshot could not be found.

> If a client on an old version of a document submits an op, that op needs to be transformed by all the ops that have been applied to the document in the meantime. If the server cannot fetch these ops from the database, then this error is returned.

> The most common case of this would be ops being deleted from the database. For example, let's assume we have a TTL set up on the ops in our database. Let's also say we have a client that is so out-of-date that the op corresponding to its version has been deleted by the TTL policy. If this client then attempts to submit an op, the server will not be able to find the ops required to transform the op to apply to the current version of the snapshot.

> Other causes of this error may be dropping the ops collection all together, or having the database corrupted in some other way.

### `ERR_MAX_SUBMIT_RETRIES_EXCEEDED`

> The number of retries defined by the [`maxSubmitRetries`]({{ site.baseurl }}{% link api/backend.md %}#options) option has been exceeded by a submission.

### `ERR_DOC_ALREADY_CREATED`

> The creation request has failed, because the document was already created by another client.

> This can happen when two clients happen to simultaneously try to create the same document, and is potentially recoverable by simply fetching the already-created document.

### `ERR_DOC_WAS_DELETED`

> The deletion request has failed, because the document was already deleted by another client.

> This can happen when two clients happen to simultaneously try to delete the same document. Given that the end result is the same, this error can potentially just be ignored.

### `ERR_DOC_TYPE_NOT_RECOGNIZED`

> The specified document [type]({{ site.baseurl }}{% link types/index.md %}) has not been registered with ShareDB.

> This error can usually be remedied by remembering to [register]({{ site.baseurl }}{% link types/index.md %}#installing-other-types) any types you need.

### `ERR_DEFAULT_TYPE_MISMATCH`

> The default type being used by the client does not match the default type expected by the server.

> This will typically only happen when using a different default type to the built-in `json0` used by ShareDB by default (e.g. if using a fork). The exact same type must be used by both the client and the server, and should be registered as the default type:

> ```javascript
> var ShareDB = require('sharedb');
> var forkedJson0 = require('forked-json0');
>
> // Make sure to also do this on your client
> ShareDB.types.defaultType = forkedJson0.type;
> ```

### `ERR_OP_NOT_ALLOWED_IN_PROJECTION`

> The submitted op is not valid when applied to the projection.

> This may happen if the op targets some property that is not included in the projection.

### `ERR_TYPE_CANNOT_BE_PROJECTED`

> The document's type cannot be projected. [`json0`]({{ site.baseurl }}{% link types/json0.md %}) is currently the only type that supports projections.
