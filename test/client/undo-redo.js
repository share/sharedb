var async = require('async');
var lolex = require("lolex");
var util = require('../util');
var errorHandler = util.errorHandler;
var Backend = require('../../lib/backend');
var ShareDBError = require('../../lib/error');
var expect = require('expect.js');
var types = require('../../lib/types');
var otText = require('ot-text');
var otRichText = require('@teamwork/ot-rich-text');
var richText = require('rich-text');
var invertibleType = require('./invertible-type');

types.register(otText.type);
types.register(richText.type);
types.register(otRichText.type);
types.register(invertibleType.type);
types.register(invertibleType.typeWithDiff);
types.register(invertibleType.typeWithDiffX);
types.register(invertibleType.typeWithDiffAndDiffX);
types.register(invertibleType.typeWithTransformX);

describe('client undo/redo', function() {
  beforeEach(function() {
    this.clock = lolex.install();
    this.backend = new Backend();
    this.connection = this.backend.connect();
    this.connection2 = this.backend.connect();
    this.doc = this.connection.get('dogs', 'fido');
    this.doc2 = this.connection2.get('dogs', 'fido');
  });

  afterEach(function(done) {
    this.backend.close(done);
    this.clock.uninstall();
  });

  it('submits a non-undoable operation', function(allDone) {
    var undoManager = this.connection.createUndoManager();
    async.series([
      this.doc.create.bind(this.doc, { test: 5 }),
      this.doc.submitOp.bind(this.doc, [ { p: [ 'test' ], na: 2 } ]),
      function(done) {
        expect(this.doc.version).to.equal(2);
        expect(this.doc.data).to.eql({ test: 7 });
        expect(undoManager.canUndo()).to.equal(false);
        expect(undoManager.canRedo()).to.equal(false);
        done();
      }.bind(this)
    ], allDone);
  });

  it('receives a remote operation', function(done) {
    var undoManager = this.connection.createUndoManager();
    this.doc2.preventCompose = true;
    this.doc.on('op', function() {
      expect(this.doc.version).to.equal(2);
      expect(this.doc.data).to.eql({ test: 7 });
      expect(undoManager.canUndo()).to.equal(false);
      expect(undoManager.canRedo()).to.equal(false);
      done();
    }.bind(this));
    this.doc.subscribe(function() {
      this.doc2.create({ test: 5 });
      this.doc2.submitOp([ { p: [ 'test' ], na: 2 } ]);
    }.bind(this));
  });

  it('submits an undoable operation', function(allDone) {
    var undoManager = this.connection.createUndoManager();
    async.series([
      this.doc.create.bind(this.doc, { test: 5 }),
      this.doc.submitOp.bind(this.doc, [ { p: [ 'test' ], na: 2 } ], { undoable: true }),
      function(done) {
        expect(this.doc.version).to.equal(2);
        expect(this.doc.data).to.eql({ test: 7 });
        expect(undoManager.canUndo()).to.equal(true);
        expect(undoManager.canRedo()).to.equal(false);
        done();
      }.bind(this)
    ], allDone);
  });

  it('undoes an operation', function(allDone) {
    var undoManager = this.connection.createUndoManager();
    async.series([
      this.doc.create.bind(this.doc, { test: 5 }),
      this.doc.submitOp.bind(this.doc, [ { p: [ 'test' ], na: 2 } ], { undoable: true }),
      undoManager.undo.bind(undoManager),
      function(done) {
        expect(this.doc.version).to.equal(3);
        expect(this.doc.data).to.eql({ test: 5 });
        expect(undoManager.canUndo()).to.equal(false);
        expect(undoManager.canRedo()).to.equal(true);
        done();
      }.bind(this)
    ], allDone);
  });

  it('redoes an operation', function(allDone) {
    var undoManager = this.connection.createUndoManager();
    async.series([
      this.doc.create.bind(this.doc, { test: 5 }),
      this.doc.submitOp.bind(this.doc, [ { p: [ 'test' ], na: 2 } ], { undoable: true }),
      undoManager.undo.bind(undoManager),
      undoManager.redo.bind(undoManager),
      function(done) {
        expect(this.doc.version).to.equal(4);
        expect(this.doc.data).to.eql({ test: 7 });
        expect(undoManager.canUndo()).to.equal(true);
        expect(undoManager.canRedo()).to.equal(false);
        done();
      }.bind(this)
    ], allDone);
  });

  it('performs a series of undo and redo operations', function(allDone) {
    var undoManager = this.connection.createUndoManager();
    async.series([
      this.doc.create.bind(this.doc, { test: 5 }),
      this.doc.submitOp.bind(this.doc, [ { p: [ 'test' ], na: 2 } ], { undoable: true }),
      undoManager.undo.bind(undoManager),
      undoManager.redo.bind(undoManager),
      undoManager.undo.bind(undoManager),
      undoManager.redo.bind(undoManager),
      undoManager.undo.bind(undoManager),
      undoManager.redo.bind(undoManager),
      function(done) {
        expect(this.doc.version).to.equal(8);
        expect(this.doc.data).to.eql({ test: 7 });
        expect(undoManager.canUndo()).to.equal(true);
        expect(undoManager.canRedo()).to.equal(false);
        done();
      }.bind(this)
    ], allDone);
  });

  it('performs a series of undo and redo operations synchronously', function() {
    var undoManager = this.connection.createUndoManager();
    this.doc.create({ test: 5 }),
    this.doc.submitOp([ { p: [ 'test' ], na: 2 } ], { undoable: true }),
    expect(this.doc.data).to.eql({ test: 7 });
    undoManager.undo(),
    expect(this.doc.data).to.eql({ test: 5 });
    undoManager.redo(),
    expect(this.doc.data).to.eql({ test: 7 });
    undoManager.undo(),
    expect(this.doc.data).to.eql({ test: 5 });
    undoManager.redo(),
    expect(this.doc.data).to.eql({ test: 7 });
    undoManager.undo(),
    expect(this.doc.data).to.eql({ test: 5 });
    undoManager.redo(),
    expect(this.doc.data).to.eql({ test: 7 });
    expect(undoManager.canUndo()).to.equal(true);
    expect(undoManager.canRedo()).to.equal(false);
  });

  it('undoes one of two operations', function(allDone) {
    var undoManager = this.connection.createUndoManager({ composeInterval: -1 });
    async.series([
      this.doc.create.bind(this.doc, { test: 5 }),
      this.doc.submitOp.bind(this.doc, [ { p: [ 'test' ], na: 2 } ], { undoable: true }),
      this.doc.submitOp.bind(this.doc, [ { p: [ 'test' ], na: 3 } ], { undoable: true }),
      undoManager.undo.bind(undoManager),
      function(done) {
        expect(this.doc.version).to.equal(4);
        expect(this.doc.data).to.eql({ test: 7 });
        expect(undoManager.canUndo()).to.equal(true);
        expect(undoManager.canRedo()).to.equal(true);
        done();
      }.bind(this)
    ], allDone);
  });

  it('undoes two of two operations', function(allDone) {
    var undoManager = this.connection.createUndoManager({ composeInterval: -1 });
    async.series([
      this.doc.create.bind(this.doc, { test: 5 }),
      this.doc.submitOp.bind(this.doc, [ { p: [ 'test' ], na: 2 } ], { undoable: true }),
      this.doc.submitOp.bind(this.doc, [ { p: [ 'test' ], na: 3 } ], { undoable: true }),
      undoManager.undo.bind(undoManager),
      undoManager.undo.bind(undoManager),
      function(done) {
        expect(this.doc.version).to.equal(5);
        expect(this.doc.data).to.eql({ test: 5 });
        expect(undoManager.canUndo()).to.equal(false);
        expect(undoManager.canRedo()).to.equal(true);
        done();
      }.bind(this)
    ], allDone);
  });

  it('redoes one of two operations', function(allDone) {
    var undoManager = this.connection.createUndoManager({ composeInterval: -1 });
    async.series([
      this.doc.create.bind(this.doc, { test: 5 }),
      this.doc.submitOp.bind(this.doc, [ { p: [ 'test' ], na: 2 } ], { undoable: true }),
      this.doc.submitOp.bind(this.doc, [ { p: [ 'test' ], na: 3 } ], { undoable: true }),
      undoManager.undo.bind(undoManager),
      undoManager.undo.bind(undoManager),
      undoManager.redo.bind(undoManager),
      function(done) {
        expect(this.doc.version).to.equal(6);
        expect(this.doc.data).to.eql({ test: 7 });
        expect(undoManager.canUndo()).to.equal(true);
        expect(undoManager.canRedo()).to.equal(true);
        done();
      }.bind(this)
    ], allDone);
  });

  it('redoes two of two operations', function(allDone) {
    var undoManager = this.connection.createUndoManager({ composeInterval: -1 });
    async.series([
      this.doc.create.bind(this.doc, { test: 5 }),
      this.doc.submitOp.bind(this.doc, [ { p: [ 'test' ], na: 2 } ], { undoable: true }),
      this.doc.submitOp.bind(this.doc, [ { p: [ 'test' ], na: 3 } ], { undoable: true }),
      undoManager.undo.bind(undoManager),
      undoManager.undo.bind(undoManager),
      undoManager.redo.bind(undoManager),
      undoManager.redo.bind(undoManager),
      function(done) {
        expect(this.doc.version).to.equal(7);
        expect(this.doc.data).to.eql({ test: 10 });
        expect(undoManager.canUndo()).to.equal(true);
        expect(undoManager.canRedo()).to.equal(false);
        done();
      }.bind(this)
    ], allDone);
  });

  it('calls undo, when canUndo is false', function(done) {
    var undoManager = this.connection.createUndoManager();
    expect(undoManager.canUndo()).to.equal(false);
    undoManager.undo(done);
  });

  it('calls undo, when canUndo is false - no callback', function() {
    var undoManager = this.connection.createUndoManager();
    expect(undoManager.canUndo()).to.equal(false);
    undoManager.undo();
  });

  it('calls redo, when canRedo is false', function(done) {
    var undoManager = this.connection.createUndoManager();
    expect(undoManager.canRedo()).to.equal(false);
    undoManager.redo(done);
  });

  it('calls redo, when canRedo is false - no callback', function() {
    var undoManager = this.connection.createUndoManager();
    expect(undoManager.canRedo()).to.equal(false);
    undoManager.redo();
  });

  it('preserves source on create', function(done) {
    this.doc.on('create', function(source) {
      expect(source).to.equal('test source');
      done();
    });
    this.doc.create({ test: 5 }, null, { source: 'test source' });
  });

  it('preserves source on del', function(done) {
    this.doc.on('del', function(oldContent, source) {
      expect(source).to.equal('test source');
      done();
    });
    this.doc.create({ test: 5 });
    this.doc.del({ source: 'test source' });
  });

  it('preserves source on submitOp', function(done) {
    this.doc.on('op', function(op, source) {
      expect(source).to.equal('test source');
      done();
    });
    this.doc.create({ test: 5 });
    this.doc.submitOp([ { p: [ 'test' ], na: 2 } ], { source: 'test source' });
  });

  it('preserves source on undo', function(done) {
    var undoManager = this.connection.createUndoManager();
    this.doc.create({ test: 5 });
    this.doc.submitOp([ { p: [ 'test' ], na: 2 } ], { undoable: true });
    this.doc.on('op', function(op, source) {
      expect(source).to.equal('test source');
      done();
    });
    undoManager.undo({ source: 'test source' });
  });

  it('preserves source on redo', function(done) {
    var undoManager = this.connection.createUndoManager();
    this.doc.create({ test: 5 });
    this.doc.submitOp([ { p: [ 'test' ], na: 2 } ], { undoable: true });
    undoManager.undo();
    this.doc.on('op', function(op, source) {
      expect(source).to.equal('test source');
      done();
    });
    undoManager.redo({ source: 'test source' });
  });

  it('has source=false on remote operations', function(done) {
    this.doc.on('op', function(op, source) {
      expect(source).to.equal(false);
      done();
    });
    this.doc.subscribe(function() {
      this.doc2.preventCompose = true;
      this.doc2.create({ test: 5 });
      this.doc2.submitOp([ { p: [ 'test' ], na: 2 } ]);
    }.bind(this));
  });

  it('composes undoable operations within time limit', function(done) {
    var undoManager = this.connection.createUndoManager();
    this.doc.create({ test: 5 });
    this.doc.submitOp([ { p: [ 'test' ], na: 2 } ], { undoable: true });
    setTimeout(function() {
      this.doc.submitOp([ { p: [ 'test' ], na: 3 } ], { undoable: true });
      expect(this.doc.data).to.eql({ test: 10 });
      undoManager.undo();
      expect(this.doc.data).to.eql({ test: 5 });
      expect(undoManager.canUndo()).to.equal(false);
      done();
    }.bind(this), 1000);
    this.clock.runAll();
  });

  it('composes undoable operations correctly', function() {
    var undoManager = this.connection.createUndoManager();
    this.doc.create({ a: 1, b: 2 });
    this.doc.submitOp([ { p: [ 'a' ], od: 1 } ], { undoable: true });
    this.doc.submitOp([ { p: [ 'b' ], od: 2 } ], { undoable: true });
    expect(this.doc.data).to.eql({});
    expect(undoManager.canRedo()).to.equal(false);
    var opCalled = false;
    this.doc.once('op', function(op) {
      opCalled = true;
      expect(op).to.eql([ { p: [ 'b' ], oi: 2 }, { p: [ 'a' ], oi: 1 } ]);
    });
    undoManager.undo();
    expect(opCalled).to.equal(true);
    expect(this.doc.data).to.eql({ a: 1, b: 2 });
    expect(undoManager.canUndo()).to.equal(false);
    undoManager.redo();
    expect(this.doc.data).to.eql({});
    expect(undoManager.canRedo()).to.equal(false);
  });

  it('does not compose undoable operations outside time limit', function(done) {
    var undoManager = this.connection.createUndoManager();
    this.doc.create({ test: 5 });
    this.doc.submitOp([ { p: [ 'test' ], na: 2 } ], { undoable: true });
    setTimeout(function () {
      this.doc.submitOp([ { p: [ 'test' ], na: 3 } ], { undoable: true });
      expect(this.doc.data).to.eql({ test: 10 });
      undoManager.undo();
      expect(this.doc.data).to.eql({ test: 7 });
      expect(undoManager.canUndo()).to.equal(true);
      undoManager.undo();
      expect(this.doc.data).to.eql({ test: 5 });
      expect(undoManager.canUndo()).to.equal(false);
      done();
    }.bind(this), 1001);
    this.clock.runAll();
  });

  it('does not compose undoable operations, if composeInterval < 0', function() {
    var undoManager = this.connection.createUndoManager({ composeInterval: -1 });
    this.doc.create({ test: 5 });
    this.doc.submitOp([ { p: [ 'test' ], na: 2 } ], { undoable: true });
    this.doc.submitOp([ { p: [ 'test' ], na: 3 } ], { undoable: true });
    expect(this.doc.data).to.eql({ test: 10 });
    undoManager.undo();
    expect(this.doc.data).to.eql({ test: 7 });
    expect(undoManager.canUndo()).to.equal(true);
    undoManager.undo();
    expect(this.doc.data).to.eql({ test: 5 });
    expect(undoManager.canUndo()).to.equal(false);
  });

  it('does not compose undoable operations, if type does not support compose nor composeSimilar', function() {
    var undoManager = this.connection.createUndoManager();
    this.doc.create(5, invertibleType.type.uri);
    this.doc.submitOp(2, { undoable: true });
    expect(this.doc.data).to.equal(7);
    this.doc.submitOp(2, { undoable: true });
    expect(this.doc.data).to.equal(9);
    undoManager.undo();
    expect(this.doc.data).to.equal(7);
    undoManager.undo();
    expect(this.doc.data).to.equal(5);
    expect(undoManager.canUndo()).to.equal(false);
    undoManager.redo();
    expect(this.doc.data).to.equal(7);
    undoManager.redo();
    expect(this.doc.data).to.equal(9);
    expect(undoManager.canRedo()).to.equal(false);
  });

  it('uses applyAndInvert, if available', function() {
    var undoManager = this.connection.createUndoManager({ composeInterval: -1 });
    this.doc.create([], otRichText.type.uri);
    this.doc.submitOp([ otRichText.Action.createInsertText('two') ], { undoable: true });
    expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('two') ]);
    this.doc.submitOp([ otRichText.Action.createInsertText('one') ], { undoable: true });
    expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('onetwo') ]);
    undoManager.undo();
    expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('two') ]);
    undoManager.undo();
    expect(this.doc.data).to.eql([]);
    undoManager.redo();
    expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('two') ]);
    undoManager.redo();
    expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('onetwo') ]);
  });

  it('fails to submit undoable op, if type is not invertible (callback)', function(done) {
    this.doc.create('two', otText.type.uri);
    this.doc.on('error', done);
    this.doc.submitOp([ 'one' ], { undoable: true }, function(err) {
      expect(err.code).to.equal(4025);
      done();
    });
  });

  it('fails to submit undoable op, if type is not invertible (no callback)', function(done) {
    this.doc.create('two', otText.type.uri);
    this.doc.on('error', function(err) {
      expect(err.code).to.equal(4025);
      done();
    });
    this.doc.submitOp([ 'one' ], { undoable: true });
  });

  it('fails to submit undoable snapshot, if type is not invertible (callback)', function(done) {
    this.doc.create([], richText.type.uri);
    this.doc.on('error', done);
    this.doc.submitSnapshot([ { insert: 'abc' } ], { undoable: true }, function(err) {
      expect(err.code).to.equal(4025);
      done();
    });
  });

  it('fails to submit undoable snapshot, if type is not invertible (no callback)', function(done) {
    this.doc.create([], richText.type.uri);
    this.doc.on('error', function(err) {
      expect(err.code).to.equal(4025);
      done();
    });
    this.doc.submitSnapshot([ { insert: 'abc' } ], { undoable: true });
  });

  it('fails to submit with fixUp, if type is not invertible', function(done) {
    var undoManager = this.connection.createUndoManager();
    this.doc.create('two', otText.type.uri);
    this.doc.on('error', done);
    this.doc.submitOp([ 'one' ], { fixUp: true }, function(err) {
      expect(err.code).to.equal(4025);
      done();
    });
  });

  it('composes similar operations', function() {
    var undoManager = this.connection.createUndoManager();
    this.doc.create([], otRichText.type.uri);
    this.doc.submitOp([
      otRichText.Action.createInsertText('one')
    ], { undoable: true });
    this.doc.submitOp([
      otRichText.Action.createRetain(3),
      otRichText.Action.createInsertText('two')
    ], { undoable: true });
    expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('onetwo') ]);
    expect(undoManager.canRedo()).to.equal(false);
    undoManager.undo();
    expect(this.doc.data).to.eql([]);
    expect(undoManager.canUndo()).to.equal(false);
    undoManager.redo();
    expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('onetwo') ]);
    expect(undoManager.canRedo()).to.equal(false);
  });

  it('does not compose dissimilar operations', function() {
    var undoManager = this.connection.createUndoManager();
    this.doc.create([ otRichText.Action.createInsertText(' ') ], otRichText.type.uri);

    this.doc.submitOp([ otRichText.Action.createRetain(1), otRichText.Action.createInsertText('two') ], { undoable: true });
    expect(this.doc.data).to.eql([ otRichText.Action.createInsertText(' two') ]);

    this.doc.submitOp([ otRichText.Action.createInsertText('one') ], { undoable: true });
    expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('one two') ]);

    undoManager.undo();
    expect(this.doc.data).to.eql([ otRichText.Action.createInsertText(' two') ]);

    undoManager.undo();
    expect(this.doc.data).to.eql([ otRichText.Action.createInsertText(' ') ]);

    undoManager.redo();
    expect(this.doc.data).to.eql([ otRichText.Action.createInsertText(' two') ]);

    undoManager.redo();
    expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('one two') ]);
  });

  it('does not add no-ops to the undo stack on undoable operation', function() {
    var undoManager = this.connection.createUndoManager();
    var opCalled = false;
    this.doc.create([ otRichText.Action.createInsertText('test', [ 'key', 'value' ]) ], otRichText.type.uri);
    this.doc.on('op', function(op, source) {
      expect(op).to.eql([ otRichText.Action.createRetain(4, [ 'key', 'value' ]) ]);
      opCalled = true;
    });
    this.doc.submitOp([ otRichText.Action.createRetain(4, [ 'key', 'value' ]) ], { undoable: true });
    expect(opCalled).to.equal(true);
    expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('test', [ 'key', 'value' ]) ]);
    expect(undoManager.canUndo()).to.eql(false);
    expect(undoManager.canRedo()).to.eql(false);
  });

  it('limits the size of the undo stack', function() {
    var undoManager = this.connection.createUndoManager({ limit: 2, composeInterval: -1 });
    this.doc.create({ test: 5 });
    this.doc.submitOp([ { p: [ 'test' ], na: 2 } ], { undoable: true });
    this.doc.submitOp([ { p: [ 'test' ], na: 2 } ], { undoable: true });
    this.doc.submitOp([ { p: [ 'test' ], na: 2 } ], { undoable: true });
    expect(this.doc.data).to.eql({ test: 11 });
    expect(undoManager.canUndo()).to.equal(true);
    undoManager.undo();
    expect(undoManager.canUndo()).to.equal(true);
    undoManager.undo();
    expect(undoManager.canUndo()).to.equal(false);
    undoManager.undo();
    expect(this.doc.data).to.eql({ test: 7 });
  });

  it('does not compose the next operation after undo', function() {
    var undoManager = this.connection.createUndoManager();
    this.doc.create({ test: 5 });
    this.clock.tick(1001);
    this.doc.submitOp([ { p: [ 'test' ], na: 2 } ], { undoable: true }); // not composed
    this.clock.tick(1001);
    this.doc.submitOp([ { p: [ 'test' ], na: 2 } ], { undoable: true }); // not composed
    undoManager.undo();
    this.doc.submitOp([ { p: [ 'test' ], na: 2 } ], { undoable: true }); // not composed
    this.doc.submitOp([ { p: [ 'test' ], na: 2 } ], { undoable: true }); // composed
    expect(this.doc.data).to.eql({ test: 11 });
    expect(undoManager.canUndo()).to.equal(true);

    undoManager.undo();
    expect(this.doc.data).to.eql({ test: 7 });
    expect(undoManager.canUndo()).to.equal(true);

    undoManager.undo();
    expect(this.doc.data).to.eql({ test: 5 });
    expect(undoManager.canUndo()).to.equal(false);
  });

  it('does not compose the next operation after undo and redo', function() {
    var undoManager = this.connection.createUndoManager();
    this.doc.create({ test: 5 });
    this.clock.tick(1001);
    this.doc.submitOp([ { p: [ 'test' ], na: 2 } ], { undoable: true }); // not composed
    this.clock.tick(1001);
    this.doc.submitOp([ { p: [ 'test' ], na: 2 } ], { undoable: true }); // not composed
    undoManager.undo();
    undoManager.redo();
    this.doc.submitOp([ { p: [ 'test' ], na: 2 } ], { undoable: true }); // not composed
    this.doc.submitOp([ { p: [ 'test' ], na: 2 } ], { undoable: true }); // composed
    expect(this.doc.data).to.eql({ test: 13 });
    expect(undoManager.canUndo()).to.equal(true);

    undoManager.undo();
    expect(this.doc.data).to.eql({ test: 9 });
    expect(undoManager.canUndo()).to.equal(true);

    undoManager.undo();
    expect(this.doc.data).to.eql({ test: 7 });
    expect(undoManager.canUndo()).to.equal(true);

    undoManager.undo();
    expect(this.doc.data).to.eql({ test: 5 });
    expect(undoManager.canUndo()).to.equal(false);
  });

  it('transforms the stacks by remote operations', function(done) {
    var undoManager = this.connection.createUndoManager({ composeInterval: -1 });
    this.doc2.subscribe();
    this.doc.subscribe();
    this.doc.create([], otRichText.type.uri);
    this.doc.submitOp([ otRichText.Action.createInsertText('4') ], { undoable: true });
    this.doc.submitOp([ otRichText.Action.createInsertText('3') ], { undoable: true });
    this.doc.submitOp([ otRichText.Action.createInsertText('2') ], { undoable: true });
    this.doc.submitOp([ otRichText.Action.createInsertText('1') ], { undoable: true });
    undoManager.undo();
    undoManager.undo();
    this.doc.whenNothingPending(function() {
      this.doc.once('op', function(op, source) {
        expect(source).to.equal(false);
        expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('ABC34') ]);
        undoManager.undo();
        expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('ABC4') ]);
        undoManager.undo();
        expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('ABC') ]);
        undoManager.redo();
        expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('ABC4') ]);
        undoManager.redo();
        expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('ABC34') ]);
        undoManager.redo();
        expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('ABC234') ]);
        undoManager.redo();
        expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('ABC1234') ]);
        done();
      }.bind(this));
      this.doc2.submitOp([ otRichText.Action.createInsertText('ABC') ]);
    }.bind(this));
  });

  it('transforms the stacks by remote operations and removes no-ops', function(done) {
    var undoManager = this.connection.createUndoManager({ composeInterval: -1 });
    this.doc2.subscribe();
    this.doc.subscribe();
    this.doc.create([], otRichText.type.uri);
    this.doc.submitOp([ otRichText.Action.createInsertText('4') ], { undoable: true });
    this.doc.submitOp([ otRichText.Action.createInsertText('3') ], { undoable: true });
    this.doc.submitOp([ otRichText.Action.createInsertText('2') ], { undoable: true });
    this.doc.submitOp([ otRichText.Action.createInsertText('1') ], { undoable: true });
    undoManager.undo();
    undoManager.undo();
    this.doc.whenNothingPending(function() {
      this.doc.once('op', function(op, source) {
        expect(source).to.equal(false);
        expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('4') ]);
        undoManager.undo();
        expect(this.doc.data).to.eql([]);
        expect(undoManager.canUndo()).to.equal(false);
        undoManager.redo();
        expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('4') ]);
        undoManager.redo();
        expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('24') ]);
        undoManager.redo();
        expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('124') ]);
        expect(undoManager.canRedo()).to.equal(false);
        done();
      }.bind(this));
      this.doc2.submitOp([ otRichText.Action.createDelete(1) ]);
    }.bind(this));
  });

  it('transforms the stacks by a local operation', function() {
    var undoManager = this.connection.createUndoManager({ composeInterval: -1 });
    this.doc.create([], otRichText.type.uri);
    this.doc.submitOp([ otRichText.Action.createInsertText('4') ], { undoable: true });
    this.doc.submitOp([ otRichText.Action.createInsertText('3') ], { undoable: true });
    this.doc.submitOp([ otRichText.Action.createInsertText('2') ], { undoable: true });
    this.doc.submitOp([ otRichText.Action.createInsertText('1') ], { undoable: true });
    undoManager.undo();
    undoManager.undo();
    this.doc.submitOp([ otRichText.Action.createInsertText('ABC') ]);
    expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('ABC34') ]);
    undoManager.undo();
    expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('ABC4') ]);
    undoManager.undo();
    expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('ABC') ]);
    undoManager.redo();
    expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('ABC4') ]);
    undoManager.redo();
    expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('ABC34') ]);
    undoManager.redo();
    expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('ABC234') ]);
    undoManager.redo();
    expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('ABC1234') ]);
  });

  it('transforms the stacks by a local operation and removes no-ops', function() {
    var undoManager = this.connection.createUndoManager({ composeInterval: -1 });
    this.doc.create([], otRichText.type.uri);
    this.doc.submitOp([ otRichText.Action.createInsertText('4') ], { undoable: true });
    this.doc.submitOp([ otRichText.Action.createInsertText('3') ], { undoable: true });
    this.doc.submitOp([ otRichText.Action.createInsertText('2') ], { undoable: true });
    this.doc.submitOp([ otRichText.Action.createInsertText('1') ], { undoable: true });
    undoManager.undo();
    undoManager.undo();
    this.doc.submitOp([ otRichText.Action.createDelete(1) ]);
    expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('4') ]);
    undoManager.undo();
    expect(this.doc.data).to.eql([]);
    expect(undoManager.canUndo()).to.equal(false);
    undoManager.redo();
    expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('4') ]);
    undoManager.redo();
    expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('24') ]);
    undoManager.redo();
    expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('124') ]);
    expect(undoManager.canRedo()).to.equal(false);
  });

  it('transforms stacks by an undoable op', function() {
    var undoManager = this.connection.createUndoManager({ composeInterval: -1, source: '1' });
    this.doc.create([], otRichText.type.uri);
    this.doc.submitOp([ otRichText.Action.createInsertText('4') ], { undoable: true, source: '1' });
    this.doc.submitOp([ otRichText.Action.createInsertText('3') ], { undoable: true, source: '1' });
    this.doc.submitOp([ otRichText.Action.createInsertText('2') ], { undoable: true, source: '1' });
    this.doc.submitOp([ otRichText.Action.createInsertText('1') ], { undoable: true, source: '1' });
    undoManager.undo();
    undoManager.undo();

    // The source does not match, so undoManager transforms its stacks rather than pushing this op on its undo stack.
    this.doc.submitOp([ otRichText.Action.createInsertText('ABC') ], { undoable: true });

    expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('ABC34') ]);
    undoManager.undo();
    expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('ABC4') ]);
    undoManager.undo();
    expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('ABC') ]);
    undoManager.redo();
    expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('ABC4') ]);
    undoManager.redo();
    expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('ABC34') ]);
    undoManager.redo();
    expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('ABC234') ]);
    undoManager.redo();
    expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('ABC1234') ]);
  });

  it('transforms stacks by an undo op', function() {
    var undoManager = this.connection.createUndoManager({ composeInterval: -1, source: '1' });
    var undoManager2 = this.connection.createUndoManager({ composeInterval: -1, source: '2' });
    this.doc.create([], otRichText.type.uri);
    this.doc.submitOp([ otRichText.Action.createInsertText('4') ], { undoable: true, source: '1' });
    this.doc.submitOp([ otRichText.Action.createInsertText('3') ], { undoable: true, source: '1' });
    this.doc.submitOp([ otRichText.Action.createInsertText('2') ], { undoable: true, source: '1' });
    this.doc.submitOp([ otRichText.Action.createInsertText('1') ], { undoable: true, source: '1' });
    undoManager.undo();
    undoManager.undo();

    // These 2 ops cancel each other out, so the undoManager's stacks remain unaffected,
    // even though they are transformed against those ops.
    // The second op has `source: '2'`, so it is inverted and added to the undo stack of undoManager2.
    this.doc.submitOp([ otRichText.Action.createInsertText('ABC') ], { undoable: true });
    this.doc.submitOp([ otRichText.Action.createDelete(3) ], { undoable: true, source: '2' });
    // This inserts ABC at position 0 and the undoManager's stacks are transformed accordingly, ready for testing.
    undoManager2.undo();

    expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('ABC34') ]);
    undoManager.undo();
    expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('ABC4') ]);
    undoManager.undo();
    expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('ABC') ]);
    undoManager.redo();
    expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('ABC4') ]);
    undoManager.redo();
    expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('ABC34') ]);
    undoManager.redo();
    expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('ABC234') ]);
    undoManager.redo();
    expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('ABC1234') ]);
  });

  it('transforms stacks by a redo op', function() {
    var undoManager = this.connection.createUndoManager({ composeInterval: -1, source: '1' });
    var undoManager2 = this.connection.createUndoManager({ composeInterval: -1, source: '2' });
    this.doc.create([], otRichText.type.uri);
    this.doc.submitOp([ otRichText.Action.createInsertText('4') ], { undoable: true, source: '1' });
    this.doc.submitOp([ otRichText.Action.createInsertText('3') ], { undoable: true, source: '1' });
    this.doc.submitOp([ otRichText.Action.createInsertText('2') ], { undoable: true, source: '1' });
    this.doc.submitOp([ otRichText.Action.createInsertText('1') ], { undoable: true, source: '1' });
    undoManager.undo();
    undoManager.undo();

    // submitOp and undo cancel each other out, so the undoManager's stacks remain unaffected,
    // even though they are transformed against those ops.
    // The second op has `source: '2'`, so it is inverted and added to the undo stack of undoManager2.
    this.doc.submitOp([ otRichText.Action.createInsertText('ABC') ], { undoable: true, source: '2' });
    undoManager2.undo();
    // This inserts ABC at position 0 and the undoManager's stacks are transformed accordingly, ready for testing.
    undoManager2.redo();

    expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('ABC34') ]);
    undoManager.undo();
    expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('ABC4') ]);
    undoManager.undo();
    expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('ABC') ]);
    undoManager.redo();
    expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('ABC4') ]);
    undoManager.redo();
    expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('ABC34') ]);
    undoManager.redo();
    expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('ABC234') ]);
    undoManager.redo();
    expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('ABC1234') ]);
  });

  it('transforms the stacks using transform', function() {
    var undoManager = this.connection.createUndoManager({ composeInterval: -1 });
    this.doc.create(0, invertibleType.type.uri);
    this.doc.submitOp(1, { undoable: true });
    this.doc.submitOp(10, { undoable: true });
    this.doc.submitOp(100, { undoable: true });
    this.doc.submitOp(1000, { undoable: true });
    undoManager.undo();
    undoManager.undo();
    expect(this.doc.data).to.equal(11);
    this.doc.submitOp(10000);
    undoManager.undo();
    expect(this.doc.data).to.equal(10001);
    undoManager.undo();
    expect(this.doc.data).to.equal(10000);
    undoManager.redo();
    expect(this.doc.data).to.equal(10001);
    undoManager.redo();
    expect(this.doc.data).to.equal(10011);
    undoManager.redo();
    expect(this.doc.data).to.equal(10111);
    undoManager.redo();
    expect(this.doc.data).to.equal(11111);
  });

  it('transforms the stacks using transformX', function() {
    var undoManager = this.connection.createUndoManager({ composeInterval: -1 });
    this.doc.create(0, invertibleType.typeWithTransformX.uri);
    this.doc.submitOp(1, { undoable: true });
    this.doc.submitOp(10, { undoable: true });
    this.doc.submitOp(100, { undoable: true });
    this.doc.submitOp(1000, { undoable: true });
    undoManager.undo();
    undoManager.undo();
    expect(this.doc.data).to.equal(11);
    this.doc.submitOp(10000);
    undoManager.undo();
    expect(this.doc.data).to.equal(10001);
    undoManager.undo();
    expect(this.doc.data).to.equal(10000);
    undoManager.redo();
    expect(this.doc.data).to.equal(10001);
    undoManager.redo();
    expect(this.doc.data).to.equal(10011);
    undoManager.redo();
    expect(this.doc.data).to.equal(10111);
    undoManager.redo();
    expect(this.doc.data).to.equal(11111);
  });

  it('does not skip processing when submitting a no-op by default', function(done) {
    this.doc.on('op', function() {
      expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('test') ]);
      done();
    }.bind(this));
    this.doc.create([ otRichText.Action.createInsertText('test') ], otRichText.type.uri);
    this.doc.submitOp([]);
  });

  it('does not skip processing when submitting an identical snapshot by default', function(done) {
    this.doc.on('op', function() {
      expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('test') ]);
      done();
    }.bind(this));
    this.doc.create([ otRichText.Action.createInsertText('test') ], otRichText.type.uri);
    this.doc.submitSnapshot([ otRichText.Action.createInsertText('test') ]);
  });

  it('skips processing when submitting a no-op (no callback)', function(done) {
    this.doc.on('op', function() {
      done(new Error('Should not emit `op`'));
    });
    this.doc.create([ otRichText.Action.createInsertText('test') ], otRichText.type.uri);
    this.doc.submitOp([], { skipNoop: true });
    expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('test') ]);
    done();
  });

  it('skips processing when submitting a no-op (with callback)', function(done) {
    this.doc.on('op', function() {
      done(new Error('Should not emit `op`'));
    });
    this.doc.create([ otRichText.Action.createInsertText('test') ], otRichText.type.uri);
    this.doc.submitOp([], { skipNoop: true }, done);
  });

  it('skips processing when submitting an identical snapshot (no callback)', function(done) {
    this.doc.on('op', function() {
      done(new Error('Should not emit `op`'));
    });
    this.doc.create([ otRichText.Action.createInsertText('test') ], otRichText.type.uri);
    this.doc.submitSnapshot([ otRichText.Action.createInsertText('test') ], { skipNoop: true });
    expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('test') ]);
    done();
  });

  it('skips processing when submitting an identical snapshot (with callback)', function(done) {
    this.doc.on('op', function() {
      done(new Error('Should not emit `op`'));
    });
    this.doc.create([ otRichText.Action.createInsertText('test') ], otRichText.type.uri);
    this.doc.submitSnapshot([ otRichText.Action.createInsertText('test') ], { skipNoop: true }, done);
  });

  describe('fixup operations', function() {
    beforeEach(function() {
      var undoManager = this.connection.createUndoManager({ composeInterval: -1 });

      this.assert = function(text) {
        var expected = text ? [ otRichText.Action.createInsertText(text) ] : [];
        expect(this.doc.data).to.eql(expected);
        return this;
      };
      this.submitOp = function(op, options) {
        if (typeof op === 'string') {
          this.doc.submitOp([ otRichText.Action.createInsertText(op) ], options);
        } else if (op < 0) {
          this.doc.submitOp([ otRichText.Action.createDelete(-op) ], options);
        } else {
          throw new Error('Invalid op');
        }
        return this;
      };
      this.submitSnapshot = function(snapshot, options) {
        this.doc.submitSnapshot([ otRichText.Action.createInsertText(snapshot) ], options);
        return this;
      };
      this.undo = function() {
        undoManager.undo();
        return this;
      };
      this.redo = function() {
        undoManager.redo();
        return this;
      };

      this.doc.create([], otRichText.type.uri);
      this.submitOp('d', { undoable: true }).assert('d');
      this.submitOp('c', { undoable: true }).assert('cd');
      this.submitOp('b', { undoable: true }).assert('bcd');
      this.submitOp('a', { undoable: true }).assert('abcd');
      this.undo().assert('bcd');
      this.undo().assert('cd');
      expect(undoManager.canUndo()).to.equal(true);
      expect(undoManager.canRedo()).to.equal(true);
    });

    it('does not fix up anything', function() {
      var undoManager = this.connection.createUndoManager();
      expect(undoManager.canUndo()).to.equal(false);
      expect(undoManager.canRedo()).to.equal(false);
      this.submitOp('!', { fixUp: true }).assert('!cd');
      expect(undoManager.canUndo()).to.equal(false);
      expect(undoManager.canRedo()).to.equal(false);
    });

    it('submits an op and does not fix up stacks (insert)', function() {
      this.submitOp('!').assert('!cd');
      this.undo().assert('!d');
      this.undo().assert('!');
      this.redo().assert('!d');
      this.redo().assert('!cd');
      this.redo().assert('!bcd');
      this.redo().assert('!abcd');
    });

    it('submits an op and fixes up stacks (insert)', function() {
      this.submitOp('!', { fixUp: true }).assert('!cd');
      this.undo().assert('d');
      this.undo().assert('');
      this.redo().assert('d');
      this.redo().assert('!cd');
      this.redo().assert('bcd');
      this.redo().assert('abcd');
    });

    it('submits a snapshot and does not fix up stacks (insert)', function() {
      this.submitSnapshot('!cd').assert('!cd');
      this.undo().assert('!d');
      this.undo().assert('!');
      this.redo().assert('!d');
      this.redo().assert('!cd');
      this.redo().assert('!bcd');
      this.redo().assert('!abcd');
    });

    it('submits a snapshot and fixes up stacks (insert)', function() {
      this.submitSnapshot('!cd', { fixUp: true }).assert('!cd');
      this.undo().assert('d');
      this.undo().assert('');
      this.redo().assert('d');
      this.redo().assert('!cd');
      this.redo().assert('bcd');
      this.redo().assert('abcd');
    });

    it('submits an op and does not fix up stacks (delete)', function() {
      this.submitOp(-1).assert('d');
      this.undo().assert('');
      this.undo().assert('');
      this.redo().assert('d');
      this.redo().assert('bd');
      this.redo().assert('abd');
      this.redo().assert('abd');
    });

    it('submits an op and fixes up stacks (delete)', function() {
      this.submitOp(-1, { fixUp: true }).assert('d');
      this.undo().assert('');
      this.undo().assert('');
      this.redo().assert('d');
      this.redo().assert('bcd');
      this.redo().assert('abcd');
      this.redo().assert('abcd');
    });

    it('submits a snapshot and does not fix up stacks (delete)', function() {
      this.submitSnapshot('d').assert('d');
      this.undo().assert('');
      this.undo().assert('');
      this.redo().assert('d');
      this.redo().assert('bd');
      this.redo().assert('abd');
      this.redo().assert('abd');
    });

    it('submits a snapshot and fixes up stacks (delete)', function() {
      this.submitSnapshot('d', { fixUp: true }).assert('d');
      this.undo().assert('');
      this.undo().assert('');
      this.redo().assert('d');
      this.redo().assert('bcd');
      this.redo().assert('abcd');
      this.redo().assert('abcd');
    });

    it('submits a op and fixes up stacks (redo op becomes no-op and is removed from the stack)', function() {
      this.redo().redo().assert('abcd');
      this.submitOp(-1, { undoable: true }).assert('bcd');
      this.submitOp(-1, { undoable: true }).assert('cd');
      this.submitOp(-1, { undoable: true }).assert('d');
      this.submitOp(-1, { undoable: true }).assert('');
      this.undo().undo().assert('cd');
      this.submitOp(-1, { fixUp: true }).assert('d');
      this.redo().assert('');
      this.redo().assert('');
      this.undo().assert('d');
      this.undo().assert('bcd');
      this.undo().assert('abcd');
    });

    it('fixes up the correct ops', function() {
      var doc = this.connection.get('dogs', 'toby');
      this.submitSnapshot('', { undoable: true }).assert('');
      this.submitSnapshot('d', { undoable: true }).assert('d');
      this.submitSnapshot('cd', { undoable: true }).assert('cd');
      doc.create({ test: 5 });
      doc.submitOp([ { p: [ 'test' ], na: 2 } ], { undoable: true });
      doc.submitOp([ { p: [ 'test' ], na: 2 } ], { undoable: true });
      this.submitSnapshot('bcd', { undoable: true }).assert('bcd');
      this.submitSnapshot('abcd', { undoable: true }).assert('abcd');
      this.undo().assert('bcd');
      this.undo().assert('cd');
      this.undo().assert('cd'); // undo one of the `doc` ops
      expect(doc.data).to.eql({ test: 7 });
      this.submitSnapshot('!cd', { fixUp: true }).assert('!cd');
      this.undo().assert('!cd'); // undo one of the `doc` ops
      expect(doc.data).to.eql({ test: 5 });
      this.undo().assert('d');
      this.undo().assert('');
      this.redo().assert('d');
      this.redo().assert('!cd');
      this.redo().assert('!cd'); // redo one of the `doc` ops
      expect(doc.data).to.eql({ test: 7 });
      this.redo().assert('!cd'); // redo one of the `doc` ops
      expect(doc.data).to.eql({ test: 9 });
      this.redo().assert('bcd');
      this.redo().assert('abcd');
    });

    it('fixes up ops if both fixUp and undoable are true', function() {
      this.submitOp('!', { undoable: true, fixUp: true }).assert('!cd');
      this.undo().assert('d');
      this.undo().assert('');
      this.redo().assert('d');
      this.redo().assert('!cd');
      this.redo().assert('bcd');
      this.redo().assert('abcd');
    });
  });

  it('filters undo/redo ops by source', function() {
    var undoManager1 = this.connection.createUndoManager({ composeInterval: -1, source: '1' });
    var undoManager2 = this.connection.createUndoManager({ composeInterval: -1, source: '2' });

    this.doc.create({ test: 5 });
    expect(this.doc.data.test).to.equal(5);
    expect(undoManager1.canUndo()).to.equal(false);
    expect(undoManager1.canRedo()).to.equal(false);
    expect(undoManager2.canUndo()).to.equal(false);
    expect(undoManager2.canRedo()).to.equal(false);

    this.doc.submitOp([{ p: [ 'test' ], na: 2 }], { undoable: true });
    expect(this.doc.data.test).to.equal(7);
    expect(undoManager1.canUndo()).to.equal(false);
    expect(undoManager1.canRedo()).to.equal(false);
    expect(undoManager2.canUndo()).to.equal(false);
    expect(undoManager2.canRedo()).to.equal(false);

    this.doc.submitOp([{ p: [ 'test' ], na: 2 }], { undoable: true, source: '3' });
    expect(this.doc.data.test).to.equal(9);
    expect(undoManager1.canUndo()).to.equal(false);
    expect(undoManager1.canRedo()).to.equal(false);
    expect(undoManager2.canUndo()).to.equal(false);
    expect(undoManager2.canRedo()).to.equal(false);

    this.doc.submitOp([{ p: [ 'test' ], na: 7 }], { undoable: true, source: '1' });
    expect(this.doc.data.test).to.equal(16);
    expect(undoManager1.canUndo()).to.equal(true);
    expect(undoManager1.canRedo()).to.equal(false);
    expect(undoManager2.canUndo()).to.equal(false);
    expect(undoManager2.canRedo()).to.equal(false);

    this.doc.submitOp([{ p: [ 'test' ], na: 7 }], { undoable: true, source: '1' });
    expect(this.doc.data.test).to.equal(23);
    expect(undoManager1.canUndo()).to.equal(true);
    expect(undoManager1.canRedo()).to.equal(false);
    expect(undoManager2.canUndo()).to.equal(false);
    expect(undoManager2.canRedo()).to.equal(false);

    this.doc.submitOp([{ p: [ 'test' ], na: 13 }], { undoable: true, source: '2' });
    expect(this.doc.data.test).to.equal(36);
    expect(undoManager1.canUndo()).to.equal(true);
    expect(undoManager1.canRedo()).to.equal(false);
    expect(undoManager2.canUndo()).to.equal(true);
    expect(undoManager2.canRedo()).to.equal(false);

    this.doc.submitOp([{ p: [ 'test' ], na: 13 }], { undoable: true, source: '2' });
    expect(this.doc.data.test).to.equal(49);
    expect(undoManager1.canUndo()).to.equal(true);
    expect(undoManager1.canRedo()).to.equal(false);
    expect(undoManager2.canUndo()).to.equal(true);
    expect(undoManager2.canRedo()).to.equal(false);

    undoManager1.undo();
    expect(this.doc.data.test).to.equal(42);
    expect(undoManager1.canUndo()).to.equal(true);
    expect(undoManager1.canRedo()).to.equal(true);
    expect(undoManager2.canUndo()).to.equal(true);
    expect(undoManager2.canRedo()).to.equal(false);

    undoManager2.undo();
    expect(this.doc.data.test).to.equal(29);
    expect(undoManager1.canUndo()).to.equal(true);
    expect(undoManager1.canRedo()).to.equal(true);
    expect(undoManager2.canUndo()).to.equal(true);
    expect(undoManager2.canRedo()).to.equal(true);

    undoManager1.undo();
    expect(this.doc.data.test).to.equal(22);
    expect(undoManager1.canUndo()).to.equal(false);
    expect(undoManager1.canRedo()).to.equal(true);
    expect(undoManager2.canUndo()).to.equal(true);
    expect(undoManager2.canRedo()).to.equal(true);

    undoManager2.undo();
    expect(this.doc.data.test).to.equal(9);
    expect(undoManager1.canUndo()).to.equal(false);
    expect(undoManager1.canRedo()).to.equal(true);
    expect(undoManager2.canUndo()).to.equal(false);
    expect(undoManager2.canRedo()).to.equal(true);
  });

  it('cannot undo/redo an undo/redo operation', function() {
    var undoManager1 = this.connection.createUndoManager();
    this.doc.create({ test: 5 });
    this.doc.submitOp([{ p: [ 'test' ], na: 2 }], { undoable: true });
    var undoManager2 = this.connection.createUndoManager();
    expect(this.doc.data.test).to.equal(7);
    expect(undoManager1.canUndo()).to.equal(true);
    expect(undoManager1.canRedo()).to.equal(false);
    expect(undoManager2.canUndo()).to.equal(false);
    expect(undoManager2.canRedo()).to.equal(false);

    undoManager1.undo();
    expect(this.doc.data.test).to.equal(5);
    expect(undoManager1.canUndo()).to.equal(false);
    expect(undoManager1.canRedo()).to.equal(true);
    expect(undoManager2.canUndo()).to.equal(false);
    expect(undoManager2.canRedo()).to.equal(false);

    undoManager1.redo();
    expect(this.doc.data.test).to.equal(7);
    expect(undoManager1.canUndo()).to.equal(true);
    expect(undoManager1.canRedo()).to.equal(false);
    expect(undoManager2.canUndo()).to.equal(false);
    expect(undoManager2.canRedo()).to.equal(false);
  });

  it('destroys UndoManager', function() {
    var undoManager = this.connection.createUndoManager({ composeInterval: -1 });
    var doc1 = this.connection.get('dogs', 'fido');
    var doc2 = this.connection.get('dogs', 'toby');
    doc1.create({ test: 5 });
    doc2.create({ test: 11 });
    doc1.submitOp([ { p: [ 'test' ], 'na': 2 } ], { undoable: true });
    doc2.submitOp([ { p: [ 'test' ], 'na': 2 } ], { undoable: true });
    doc1.submitOp([ { p: [ 'test' ], 'na': 2 } ], { undoable: true });
    doc2.submitOp([ { p: [ 'test' ], 'na': 2 } ], { undoable: true });
    undoManager.undo();
    undoManager.undo();
    expect(undoManager.canUndo()).to.equal(true);
    expect(undoManager.canRedo()).to.equal(true);
    undoManager.destroy();
    expect(undoManager.canUndo()).to.equal(false);
    expect(undoManager.canRedo()).to.equal(false);
    doc1.submitOp([ { p: [ 'test' ], 'na': 2 } ], { undoable: true });
    doc1.submitOp([ { p: [ 'test' ], 'na': 2 } ], { undoable: true });
    expect(undoManager.canUndo()).to.equal(false);
    expect(undoManager.canRedo()).to.equal(false);
    expect(doc1.data).to.eql({ test: 11 });
    undoManager.undo();
    expect(doc1.data).to.eql({ test: 11 });
    expect(undoManager.canUndo()).to.equal(false);
    expect(undoManager.canRedo()).to.equal(false);
  });

  it('destroys UndoManager twice', function() {
    var undoManager = this.connection.createUndoManager({ composeInterval: -1 });
    this.doc.create({ test: 5 });
    this.doc.submitOp([ { p: [ 'test' ], 'na': 2 } ], { undoable: true });
    this.doc.submitOp([ { p: [ 'test' ], 'na': 2 } ], { undoable: true });
    undoManager.undo();
    expect(undoManager.canUndo()).to.equal(true);
    expect(undoManager.canRedo()).to.equal(true);
    undoManager.destroy();
    expect(undoManager.canUndo()).to.equal(false);
    expect(undoManager.canRedo()).to.equal(false);
    undoManager.destroy();
    expect(undoManager.canUndo()).to.equal(false);
    expect(undoManager.canRedo()).to.equal(false);
  });

  describe('UndoManager.clear', function() {
    it('clears the stacks', function() {
      var undoManager = this.connection.createUndoManager({ composeInterval: -1 });
      var doc1 = this.connection.get('dogs', 'fido');
      var doc2 = this.connection.get('dogs', 'toby');
      doc1.create({ test: 5 });
      doc2.create({ test: 11 });
      doc1.submitOp([ { p: [ 'test' ], 'na': 2 } ], { undoable: true });
      doc2.submitOp([ { p: [ 'test' ], 'na': 2 } ], { undoable: true });
      doc1.submitOp([ { p: [ 'test' ], 'na': 2 } ], { undoable: true });
      doc2.submitOp([ { p: [ 'test' ], 'na': 2 } ], { undoable: true });
      undoManager.undo();
      undoManager.undo();
      expect(doc1.data).to.eql({ test: 7 });
      expect(undoManager.canUndo()).to.equal(true);
      expect(undoManager.canRedo()).to.equal(true);
      undoManager.clear();
      expect(undoManager.canUndo()).to.equal(false);
      expect(undoManager.canRedo()).to.equal(false);
      doc1.submitOp([ { p: [ 'test' ], 'na': 2 } ], { undoable: true });
      doc1.submitOp([ { p: [ 'test' ], 'na': 2 } ], { undoable: true });
      undoManager.undo();
      expect(doc1.data).to.eql({ test: 9 });
      expect(undoManager.canUndo()).to.equal(true);
      expect(undoManager.canRedo()).to.equal(true);
    });

    it('clears the stacks for a specific document', function() {
      var undoManager = this.connection.createUndoManager({ composeInterval: -1 });
      var doc1 = this.connection.get('dogs', 'fido');
      var doc2 = this.connection.get('dogs', 'toby');
      doc1.create({ test: 5 });
      doc2.create({ test: 11 });
      doc1.submitOp([ { p: [ 'test' ], 'na': 2 } ], { undoable: true });
      doc2.submitOp([ { p: [ 'test' ], 'na': 2 } ], { undoable: true });
      doc1.submitOp([ { p: [ 'test' ], 'na': 2 } ], { undoable: true });
      doc2.submitOp([ { p: [ 'test' ], 'na': 2 } ], { undoable: true });
      undoManager.undo();
      undoManager.undo();
      expect(undoManager.canUndo()).to.equal(true);
      expect(undoManager.canRedo()).to.equal(true);

      undoManager.clear(doc1);
      expect(undoManager.canUndo()).to.equal(true);
      expect(undoManager.canRedo()).to.equal(true);

      undoManager.undo();
      expect(undoManager.canUndo()).to.equal(false);
      expect(undoManager.canRedo()).to.equal(true);
      expect(doc1.data).to.eql({ test: 7 });
      expect(doc2.data).to.eql({ test: 11 });

      undoManager.redo();
      expect(undoManager.canUndo()).to.equal(true);
      expect(undoManager.canRedo()).to.equal(true);
      expect(doc1.data).to.eql({ test: 7 });
      expect(doc2.data).to.eql({ test: 13 });

      undoManager.redo();
      expect(undoManager.canUndo()).to.equal(true);
      expect(undoManager.canRedo()).to.equal(false);
      expect(doc1.data).to.eql({ test: 7 });
      expect(doc2.data).to.eql({ test: 15 });
    });

    it('clears the stacks for a specific document on del', function() {
      // NOTE we don't support undo/redo on del/create at the moment.
      // See undoManager.js for more details.
      var undoManager = this.connection.createUndoManager({ composeInterval: -1 });
      var doc1 = this.connection.get('dogs', 'fido');
      var doc2 = this.connection.get('dogs', 'toby');
      doc1.create({ test: 5 });
      doc2.create({ test: 11 });
      doc1.submitOp([ { p: [ 'test' ], 'na': 2 } ], { undoable: true });
      doc2.submitOp([ { p: [ 'test' ], 'na': 2 } ], { undoable: true });
      doc1.submitOp([ { p: [ 'test' ], 'na': 2 } ], { undoable: true });
      doc2.submitOp([ { p: [ 'test' ], 'na': 2 } ], { undoable: true });
      undoManager.undo();
      undoManager.undo();
      expect(undoManager.canUndo()).to.equal(true);
      expect(undoManager.canRedo()).to.equal(true);
      doc1.del();
      expect(undoManager.canUndo()).to.equal(true);
      expect(undoManager.canRedo()).to.equal(true);
      doc2.del();
      expect(undoManager.canUndo()).to.equal(false);
      expect(undoManager.canRedo()).to.equal(false);
    });

    it('clears the stacks for a specific document on load', function(done) {
      var shouldReject = false;
      this.backend.use('submit', function(request, next) {
        if (shouldReject) return next(request.rejectedError());
        next();
      });

      var undoManager = this.connection.createUndoManager({ composeInterval: -1 });
      var doc1 = this.connection.get('dogs', 'fido');
      var doc2 = this.connection.get('dogs', 'toby');
      doc1.create([], otRichText.type.uri);
      doc2.create([], otRichText.type.uri);
      doc1.submitOp([ otRichText.Action.createInsertText('2') ], { undoable: true });
      doc2.submitOp([ otRichText.Action.createInsertText('b') ], { undoable: true });
      doc1.submitOp([ otRichText.Action.createInsertText('1') ], { undoable: true });
      doc2.submitOp([ otRichText.Action.createInsertText('a') ], { undoable: true });
      undoManager.undo();
      undoManager.undo();
      expect(undoManager.canUndo()).to.equal(true);
      expect(undoManager.canRedo()).to.equal(true);

      this.connection.whenNothingPending(function() {
        shouldReject = true;
        doc1.submitOp([ otRichText.Action.createInsertText('!') ], function(err) {
          if (err) return done(err);
          shouldReject = false;
          expect(doc1.data).to.eql([ otRichText.Action.createInsertText('2') ]);
          expect(undoManager.canUndo()).to.equal(true);
          expect(undoManager.canRedo()).to.equal(true);

          undoManager.undo();
          expect(undoManager.canUndo()).to.equal(false);
          expect(undoManager.canRedo()).to.equal(true);
          expect(doc1.data).to.eql([ otRichText.Action.createInsertText('2') ]);
          expect(doc2.data).to.eql([]);

          undoManager.redo();
          expect(undoManager.canUndo()).to.equal(true);
          expect(undoManager.canRedo()).to.equal(true);
          expect(doc1.data).to.eql([ otRichText.Action.createInsertText('2') ]);
          expect(doc2.data).to.eql([ otRichText.Action.createInsertText('b') ]);

          undoManager.redo();
          expect(undoManager.canUndo()).to.equal(true);
          expect(undoManager.canRedo()).to.equal(false);
          expect(doc1.data).to.eql([ otRichText.Action.createInsertText('2') ]);
          expect(doc2.data).to.eql([ otRichText.Action.createInsertText('ab') ]);

          done();
        });
      }.bind(this));
    });

    it('clears the stacks for a specific document on doc destroy', function(done) {
      var undoManager = this.connection.createUndoManager({ composeInterval: -1 });
      var doc1 = this.connection.get('dogs', 'fido');
      var doc2 = this.connection.get('dogs', 'toby');
      doc1.create({ test: 5 });
      doc2.create({ test: 11 });
      doc1.submitOp([ { p: [ 'test' ], 'na': 2 } ], { undoable: true });
      doc2.submitOp([ { p: [ 'test' ], 'na': 2 } ], { undoable: true });
      doc1.submitOp([ { p: [ 'test' ], 'na': 2 } ], { undoable: true });
      doc2.submitOp([ { p: [ 'test' ], 'na': 2 } ], { undoable: true });
      undoManager.undo();
      undoManager.undo();
      expect(undoManager.canUndo()).to.equal(true);
      expect(undoManager.canRedo()).to.equal(true);
      doc1.destroy(function(err) {
        if (err) return done(err);
        expect(undoManager.canUndo()).to.equal(true);
        expect(undoManager.canRedo()).to.equal(true);
        doc2.destroy(function(err) {
          if (err) return done(err);
          expect(undoManager.canUndo()).to.equal(false);
          expect(undoManager.canRedo()).to.equal(false);
          done();
        });
      });
    });
  });

  describe('submitSnapshot', function() {
    describe('basic tests', function() {
      it('submits a snapshot when document is not created (no callback, no options)', function(done) {
        this.doc.on('error', function(error) {
          expect(error).to.be.an(Error);
          expect(error.code).to.equal(4015);
          done();
        });
        this.doc.submitSnapshot(7);
      });

      it('submits a snapshot when document is not created (no callback, with options)', function(done) {
        this.doc.on('error', function(error) {
          expect(error).to.be.an(Error);
          expect(error.code).to.equal(4015);
          done();
        });
        this.doc.submitSnapshot(7, { source: 'test' });
      });

      it('submits a snapshot when document is not created (with callback, no options)', function(done) {
        this.doc.on('error', done);
        this.doc.submitSnapshot(7, function(error) {
          expect(error).to.be.an(Error);
          expect(error.code).to.equal(4015);
          done();
        });
      });

      it('submits a snapshot when document is not created (with callback, with options)', function(done) {
        this.doc.on('error', done);
        this.doc.submitSnapshot(7, { source: 'test' }, function(error) {
          expect(error).to.be.an(Error);
          expect(error.code).to.equal(4015);
          done();
        });
      });

      it('submits a snapshot with source (no callback)', function(done) {
        var undoManager = this.connection.createUndoManager();
        this.doc.on('op', function(op, source) {
          expect(op).to.eql([ otRichText.Action.createInsertText('abc') ]);
          expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('abcdef') ]);
          expect(undoManager.canUndo()).to.equal(false);
          expect(undoManager.canRedo()).to.equal(false);
          expect(source).to.equal('test');
          done();
        }.bind(this));
        this.doc.create([ otRichText.Action.createInsertText('def') ], otRichText.type.uri);
        this.doc.submitSnapshot([ otRichText.Action.createInsertText('abcdef') ], { source: 'test' });
      });

      it('submits a snapshot with source (with callback)', function(done) {
        var undoManager = this.connection.createUndoManager();
        var opEmitted = false;
        this.doc.on('op', function(op, source) {
          expect(op).to.eql([ otRichText.Action.createInsertText('abc') ]);
          expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('abcdef') ]);
          expect(source).to.equal('test');
          expect(undoManager.canUndo()).to.equal(false);
          expect(undoManager.canRedo()).to.equal(false);
          opEmitted = true;
        }.bind(this));
        this.doc.create([ otRichText.Action.createInsertText('def') ], otRichText.type.uri);
        this.doc.submitSnapshot([ otRichText.Action.createInsertText('abcdef') ], { source: 'test' }, function(error) {
          expect(opEmitted).to.equal(true);
          done(error);
        });
      });

      it('submits a snapshot without source (no callback)', function(done) {
        var undoManager = this.connection.createUndoManager();
        this.doc.on('op', function(op, source) {
          expect(op).to.eql([ otRichText.Action.createInsertText('abc') ]);
          expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('abcdef') ]);
          expect(undoManager.canUndo()).to.equal(false);
          expect(undoManager.canRedo()).to.equal(false);
          expect(source).to.equal(true);
          done();
        }.bind(this));
        this.doc.create([ otRichText.Action.createInsertText('def') ], otRichText.type.uri);
        this.doc.submitSnapshot([ otRichText.Action.createInsertText('abcdef') ]);
      });

      it('submits a snapshot without source (with callback)', function(done) {
        var undoManager = this.connection.createUndoManager();
        var opEmitted = false;
        this.doc.on('op', function(op, source) {
          expect(op).to.eql([ otRichText.Action.createInsertText('abc') ]);
          expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('abcdef') ]);
          expect(source).to.equal(true);
          expect(undoManager.canUndo()).to.equal(false);
          expect(undoManager.canRedo()).to.equal(false);
          opEmitted = true;
        }.bind(this));
        this.doc.create([ otRichText.Action.createInsertText('def') ], otRichText.type.uri);
        this.doc.submitSnapshot([ otRichText.Action.createInsertText('abcdef') ], function(error) {
          expect(opEmitted).to.equal(true);
          done(error);
        });
      });

      it('submits snapshots and supports undo and redo', function() {
        var undoManager = this.connection.createUndoManager({ composeInterval: -1 });
        this.doc.create([ otRichText.Action.createInsertText('ghi') ], otRichText.type.uri);
        this.doc.submitSnapshot([ otRichText.Action.createInsertText('defghi') ], { undoable: true });
        expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('defghi') ]);
        this.doc.submitSnapshot([ otRichText.Action.createInsertText('abcdefghi') ], { undoable: true });
        expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('abcdefghi') ]);
        undoManager.undo();
        expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('defghi') ]);
        undoManager.undo();
        expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('ghi') ]);
        expect(undoManager.canUndo()).to.equal(false);
        undoManager.redo();
        expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('defghi') ]);
        undoManager.redo();
        expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('abcdefghi') ]);
        expect(undoManager.canRedo()).to.equal(false);
        undoManager.undo();
        expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('defghi') ]);
        undoManager.undo();
        expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('ghi') ]);
        expect(undoManager.canUndo()).to.equal(false);
      });

      it('submits snapshots and composes operations', function() {
        var undoManager = this.connection.createUndoManager();
        this.doc.create([ otRichText.Action.createInsertText('ghi') ], otRichText.type.uri);
        this.doc.submitSnapshot([ otRichText.Action.createInsertText('defghi') ], { undoable: true });
        expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('defghi') ]);
        this.doc.submitSnapshot([ otRichText.Action.createInsertText('abcdefghi') ], { undoable: true });
        expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('abcdefghi') ]);
        undoManager.undo();
        expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('ghi') ]);
        expect(undoManager.canUndo()).to.equal(false);
        undoManager.redo();
        expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('abcdefghi') ]);
        expect(undoManager.canRedo()).to.equal(false);
        undoManager.undo();
        expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('ghi') ]);
        expect(undoManager.canUndo()).to.equal(false);
      });

      it('submits a snapshot and syncs it', function(done) {
        this.doc2.on('create', function() {
          this.doc2.submitSnapshot([ otRichText.Action.createInsertText('abcdef') ]);
        }.bind(this));
        this.doc.on('op', function(op, source) {
          expect(op).to.eql([ otRichText.Action.createInsertText('abc') ]);
          expect(source).to.equal(false);
          expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('abcdef') ]);
          done();
        }.bind(this));
        this.doc2.subscribe();
        this.doc.subscribe();
        this.doc.create([ otRichText.Action.createInsertText('def') ], otRichText.type.uri);
      });

      it('submits undoable and fixed operations', function() {
        var undoManager = this.connection.createUndoManager({ composeInterval: -1 });
        this.doc.create([], otRichText.type.uri);
        this.doc.submitSnapshot([ otRichText.Action.createInsertText('a') ], { undoable: true });
        this.doc.submitSnapshot([ otRichText.Action.createInsertText('ab') ], { undoable: true });
        this.doc.submitSnapshot([ otRichText.Action.createInsertText('abc') ], { undoable: true });
        this.doc.submitSnapshot([ otRichText.Action.createInsertText('abcd') ], { undoable: true });
        this.doc.submitSnapshot([ otRichText.Action.createInsertText('abcde') ], { undoable: true });
        this.doc.submitSnapshot([ otRichText.Action.createInsertText('abcdef') ], { undoable: true });
        undoManager.undo();
        undoManager.undo();
        expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('abcd') ]);
        this.doc.submitSnapshot([ otRichText.Action.createInsertText('abc123d') ]);
        expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('abc123d') ]);
        undoManager.undo();
        expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('abc123') ]);
        undoManager.undo();
        expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('ab123') ]);
        undoManager.undo();
        expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('a123') ]);
        undoManager.undo();
        expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('123') ]);
        undoManager.redo();
        expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('a123') ]);
        undoManager.redo();
        expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('ab123') ]);
        undoManager.redo();
        expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('abc123') ]);
        undoManager.redo();
        expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('abc123d') ]);
        undoManager.redo();
        expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('abc123de') ]);
        undoManager.redo();
        expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('abc123def') ]);
      });

      it('submits a snapshot without a diffHint', function() {
        var undoManager = this.connection.createUndoManager();
        var opCalled = 0;
        this.doc.create([ otRichText.Action.createInsertText('aaaa') ], otRichText.type.uri);
        this.doc.submitSnapshot([ otRichText.Action.createInsertText('aaaaa') ], { undoable: true });
        expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('aaaaa') ]);

        this.doc.once('op', function(op) {
          expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('aaaa') ]);
          expect(op).to.eql([ otRichText.Action.createDelete(1) ]);
          opCalled++;
        }.bind(this));
        undoManager.undo();

        this.doc.once('op', function(op) {
          expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('aaaaa') ]);
          expect(op).to.eql([ otRichText.Action.createInsertText('a') ]);
          opCalled++;
        }.bind(this));
        undoManager.redo();

        expect(opCalled).to.equal(2);
      });

      it('submits a snapshot with a diffHint', function() {
        var undoManager = this.connection.createUndoManager();
        var opCalled = 0;
        this.doc.create([ otRichText.Action.createInsertText('aaaa') ], otRichText.type.uri);
        this.doc.submitSnapshot([ otRichText.Action.createInsertText('aaaaa') ], { undoable: true, diffHint: 2 });
        expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('aaaaa') ]);

        this.doc.once('op', function(op) {
          expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('aaaa') ]);
          expect(op).to.eql([ otRichText.Action.createRetain(2), otRichText.Action.createDelete(1) ]);
          opCalled++;
        }.bind(this));
        undoManager.undo();

        this.doc.once('op', function(op) {
          expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('aaaaa') ]);
          expect(op).to.eql([ otRichText.Action.createRetain(2), otRichText.Action.createInsertText('a') ]);
          opCalled++;
        }.bind(this));
        undoManager.redo();

        expect(opCalled).to.equal(2);
      });
    });

    describe('no diff nor diffX', function() {
      it('submits a snapshot (no callback)', function(done) {
        this.doc.on('error', function(error) {
          expect(error).to.be.an(Error);
          expect(error.code).to.equal(4024);
          done();
        });
        this.doc.create(5, invertibleType.type.uri);
        this.doc.submitSnapshot(7);
      });

      it('submits a snapshot (with callback)', function(done) {
        this.doc.on('error', done);
        this.doc.create(5, invertibleType.type.uri);
        this.doc.submitSnapshot(7, function(error) {
          expect(error).to.be.an(Error);
          expect(error.code).to.equal(4024);
          done();
        });
      });
    });

    describe('with diff', function () {
      it('submits a snapshot (non-undoable)', function() {
        var undoManager = this.connection.createUndoManager();
        this.doc.create(5, invertibleType.typeWithDiff.uri);
        this.doc.submitSnapshot(7);
        expect(this.doc.data).to.equal(7);
        expect(undoManager.canUndo()).to.equal(false);
        expect(undoManager.canRedo()).to.equal(false);
      });
      it('submits a snapshot (undoable)', function() {
        var undoManager = this.connection.createUndoManager();
        this.doc.create(5, invertibleType.typeWithDiff.uri);
        this.doc.submitSnapshot(7, { undoable: true });
        expect(this.doc.data).to.equal(7);
        undoManager.undo();
        expect(this.doc.data).to.equal(5);
        undoManager.redo();
        expect(this.doc.data).to.equal(7);
      });
    });

    describe('with diffX', function () {
      it('submits a snapshot (non-undoable)', function() {
        var undoManager = this.connection.createUndoManager();
        this.doc.create(5, invertibleType.typeWithDiffX.uri);
        this.doc.submitSnapshot(7);
        expect(this.doc.data).to.equal(7);
        expect(undoManager.canUndo()).to.equal(false);
        expect(undoManager.canRedo()).to.equal(false);
      });
      it('submits a snapshot (undoable)', function() {
        var undoManager = this.connection.createUndoManager();
        this.doc.create(5, invertibleType.typeWithDiffX.uri);
        this.doc.submitSnapshot(7, { undoable: true });
        expect(this.doc.data).to.equal(7);
        undoManager.undo();
        expect(this.doc.data).to.equal(5);
        undoManager.redo();
        expect(this.doc.data).to.equal(7);
      });
    });

    describe('with diff and diffX', function () {
      it('submits a snapshot (non-undoable)', function() {
        var undoManager = this.connection.createUndoManager();
        this.doc.create(5, invertibleType.typeWithDiffAndDiffX.uri);
        this.doc.submitSnapshot(7);
        expect(this.doc.data).to.equal(7);
        expect(undoManager.canUndo()).to.equal(false);
        expect(undoManager.canRedo()).to.equal(false);
      });
      it('submits a snapshot (undoable)', function() {
        var undoManager = this.connection.createUndoManager();
        this.doc.create(5, invertibleType.typeWithDiffAndDiffX.uri);
        this.doc.submitSnapshot(7, { undoable: true });
        expect(this.doc.data).to.equal(7);
        undoManager.undo();
        expect(this.doc.data).to.equal(5);
        undoManager.redo();
        expect(this.doc.data).to.equal(7);
      });
    });
  });
});
