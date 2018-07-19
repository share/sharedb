function findLastIndex(stack, doc) {
  var index = stack.length - 1;
  while (index >= 0) {
    if (stack[index].doc === doc) break;
    index--;
  }
  return index;
}

function getLast(list) {
  var lastIndex = list.length - 1;
  /* istanbul ignore if */
  if (lastIndex < 0) throw new Error('List empty');
  return list[lastIndex];
}

function setLast(list, item) {
  var lastIndex = list.length - 1;
  /* istanbul ignore if */
  if (lastIndex < 0) throw new Error('List empty');
  list[lastIndex] = item;
}

function Op(op, doc) {
  this.op = op;
  this.doc = doc;
  this.needsUndoOp = true;
}

// Manages an undo/redo stack for all operations from the specified `source`.
module.exports = UndoManager;
function UndoManager(connection, options) {
  // The Connection which created this UndoManager.
  this._connection = connection;

  // If != null, only ops from this "source" will be undoable.
  this._source = options && options.source;

  // The max number of undo operations to keep on the stack.
  this._limit = options && typeof options.limit === 'number' ? options.limit : 100;

  // The max time difference between operations in milliseconds,
  // which still allows the operations to be composed on the undoStack.
  this._composeInterval = options && typeof options.composeInterval === 'number' ? options.composeInterval : 1000;

  // Undo stack for local operations.
  this._undoStack = [];

  // Redo stack for local operations.
  this._redoStack = [];

  // The timestamp of the previous reversible operation. Used to determine if
  // the next reversible operation can be composed on the undoStack.
  this._previousUndoableOperationTime = -Infinity;
}

UndoManager.prototype.destroy = function() {
  this._connection.removeUndoManager(this);
  this.clear();
};

// Clear the undo and redo stack.
//
// @param doc If specified, clear only the ops belonging to this doc.
UndoManager.prototype.clear = function(doc) {
  if (doc) {
    var filter = function(item) { return item.doc !== doc; };
    this._undoStack = this._undoStack.filter(filter);
    this._redoStack = this._redoStack.filter(filter);
  } else {
    this._undoStack.length = 0;
    this._redoStack.length = 0;
  }
};

// Returns true, if there are any operations on the undo stack, otherwise false.
UndoManager.prototype.canUndo = function() {
  return this._undoStack.length > 0
};

// Undoes a submitted operation.
//
// @param options {source: ...}
// @param [callback] called after operation submitted
// @fires before op, op
UndoManager.prototype.undo = function(options, callback) {
  if (typeof options === 'function') {
    callback = options;
    options = null;
  }

  if (!this.canUndo()) {
    if (callback) process.nextTick(callback);
    return;
  }

  var op = getLast(this._undoStack);
  var submitOptions = { source: options && options.source };
  op.doc._submit(op, submitOptions, callback);
};

// Returns true, if there are any operations on the redo stack, otherwise false.
UndoManager.prototype.canRedo = function() {
  return this._redoStack.length > 0;
};

// Redoes an undone operation.
//
// @param options {source: ...}
// @param [callback] called after operation submitted
// @fires before op, op
UndoManager.prototype.redo = function(options, callback) {
  if (typeof options === 'function') {
    callback = options;
    options = null;
  }

  if (!this.canRedo()) {
    if (callback) process.nextTick(callback);
    return;
  }

  var op = getLast(this._redoStack);
  var submitOptions = { source: options && options.source };
  op.doc._submit(op, submitOptions, callback);
};

UndoManager.prototype.onDocLoad = function(doc) {
  this.clear(doc);
};

UndoManager.prototype.onDocDestroy = function(doc) {
  this.clear(doc);
};

UndoManager.prototype.onDocCreate = function(doc) {
  // NOTE We don't support undo on create because we can't support undo on delete.
};

UndoManager.prototype.onDocDelete = function(doc) {
  // NOTE We can't support undo on delete because we can't generate `initialData` required for `create`.
  // See https://github.com/ottypes/docs#standard-properties.
  //
  // We could support undo on delete and create in the future but that would require some breaking changes to ShareDB.
  // Here's what we could do:
  //
  // 1. Do NOT call `create` in ShareDB - ShareDB would get a valid snapshot from the client code.
  // 2. Add `validate` to OT types.
  // 3. Call `validate` in ShareDB to ensure that the snapshot from the client is valid.
  // 4. The `create` ops would contain serialized snapshots instead of `initialData`.
  this.clear(doc);
};

UndoManager.prototype.onDocOp = function(doc, op, undoOp, source, undoable, fixUp) {
  if (this.canUndo() && getLast(this._undoStack) === op) {
    this._undoStack.pop();
    this._updateStacksUndo(doc, op.op, undoOp.op);

  } else if (this.canRedo() && getLast(this._redoStack) === op) {
    this._redoStack.pop();
    this._updateStacksRedo(doc, op.op, undoOp.op);

  } else if (!fixUp && undoable && (this._source == null || this._source === source)) {
    this._updateStacksUndoable(doc, op.op, undoOp.op);

  } else {
    this._updateStacksFixed(doc, op.op, undoOp && undoOp.op, fixUp);
  }
};

UndoManager.prototype._updateStacksUndoable = function(doc, op, undoOp) {
  var now = Date.now();

  if (
    this._undoStack.length === 0 ||
    getLast(this._undoStack).doc !== doc ||
    now - this._previousUndoableOperationTime > this._composeInterval
  ) {
    this._undoStack.push(new Op(undoOp, doc));

  } else if (doc.type.composeSimilar) {
    var lastOp = getLast(this._undoStack);
    var composedOp = doc.type.composeSimilar(undoOp, lastOp.op);
    if (composedOp != null) {
      setLast(this._undoStack, new Op(composedOp, doc));
    } else {
      this._undoStack.push(new Op(undoOp, doc));
    }

  } else if (doc.type.compose) {
    var lastOp = getLast(this._undoStack);
    var composedOp = doc.type.compose(undoOp, lastOp.op);
    setLast(this._undoStack, new Op(composedOp, doc));

  } else {
    this._undoStack.push(new Op(undoOp, doc));
  }

  this._redoStack.length = 0;
  this._previousUndoableOperationTime = now;

  var isNoop = doc.type.isNoop;
  if (isNoop && isNoop(getLast(this._undoStack).op)) {
    this._undoStack.pop();
  }

  var itemsToRemove = this._undoStack.length - this._limit;
  if (itemsToRemove > 0) {
    this._undoStack.splice(0, itemsToRemove);
  }
};

UndoManager.prototype._updateStacksUndo = function(doc, op, undoOp) {
  /* istanbul ignore else */
  if (!doc.type.isNoop || !doc.type.isNoop(undoOp)) {
    this._redoStack.push(new Op(undoOp, doc));
  }
  this._previousUndoableOperationTime = -Infinity;
};

UndoManager.prototype._updateStacksRedo = function(doc, op, undoOp) {
  /* istanbul ignore else */
  if (!doc.type.isNoop || !doc.type.isNoop(undoOp)) {
    this._undoStack.push(new Op(undoOp, doc));
  }
  this._previousUndoableOperationTime = -Infinity;
};

UndoManager.prototype._updateStacksFixed = function(doc, op, undoOp, fixUp) {
  if (fixUp && undoOp != null && doc.type.compose) {
    var lastUndoIndex = findLastIndex(this._undoStack, doc);
    if (lastUndoIndex >= 0) {
      var lastOp = this._undoStack[lastUndoIndex];
      var composedOp = doc.type.compose(undoOp, lastOp.op);
      if (!doc.type.isNoop || !doc.type.isNoop(composedOp)) {
        this._undoStack[lastUndoIndex] = new Op(composedOp, doc);
      } else {
        this._undoStack.splice(lastUndoIndex, 1);
      }
    }

    var lastRedoIndex = findLastIndex(this._redoStack, doc);
    if (lastRedoIndex >= 0) {
      var lastOp = this._redoStack[lastRedoIndex];
      var composedOp = doc.type.compose(undoOp, lastOp.op);
      if (!doc.type.isNoop || !doc.type.isNoop(composedOp)) {
        this._redoStack[lastRedoIndex] = new Op(composedOp, doc);
      } else {
        this._redoStack.splice(lastRedoIndex, 1);
      }
    }

  } else {
    this._undoStack = this._transformStack(this._undoStack, doc, op);
    this._redoStack = this._transformStack(this._redoStack, doc, op);
  }
};

UndoManager.prototype._transformStack = function(stack, doc, op) {
  var transform = doc.type.transform;
  var transformX = doc.type.transformX;
  var isNoop = doc.type.isNoop;
  var newStack = [];
  var newStackIndex = 0;

  for (var i = stack.length - 1; i >= 0; --i) {
    var item = stack[i];
    if (item.doc !== doc) {
      newStack[newStackIndex++] = item;
      continue;
    }
    var stackOp = item.op;
    var transformedStackOp;
    var transformedOp;

    if (transformX) {
      var result = transformX(op, stackOp);
      transformedOp = result[0];
      transformedStackOp = result[1];
    } else {
      transformedOp = transform(op, stackOp, 'left');
      transformedStackOp = transform(stackOp, op, 'right');
    }

    if (!isNoop || !isNoop(transformedStackOp)) {
      newStack[newStackIndex++] = new Op(transformedStackOp, doc);
    }

    op = transformedOp;
  }

  return newStack.reverse();
};
