var async = require('async');
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
    this.backend = new Backend();
    this.connection = this.backend.connect();
    this.connection2 = this.backend.connect();
    this.doc = this.connection.get('dogs', 'fido');
    this.doc2 = this.connection2.get('dogs', 'fido');
  });

  afterEach(function(done) {
    this.backend.close(done);
  });

  it('submits a fixed operation', function(allDone) {
    async.series([
      this.doc.create.bind(this.doc, { test: 5 }),
      this.doc.submitOp.bind(this.doc, [ { p: [ 'test' ], na: 2 } ]),
      function(done) {
        expect(this.doc.version).to.equal(2);
        expect(this.doc.data).to.eql({ test: 7 });
        expect(this.doc.canUndo()).to.equal(false);
        expect(this.doc.canRedo()).to.equal(false);
        done();
      }.bind(this)
    ], allDone);
  });

  it('receives a remote operation', function(allDone) {
    async.series([
      this.doc.subscribe.bind(this.doc),
      this.doc2.create.bind(this.doc2, { test: 5 }),
      this.doc2.submitOp.bind(this.doc2, [ { p: [ 'test' ], na: 2 } ]),
      setTimeout,
      function(done) {
        expect(this.doc.version).to.equal(2);
        expect(this.doc.data).to.eql({ test: 7 });
        expect(this.doc.canUndo()).to.equal(false);
        expect(this.doc.canRedo()).to.equal(false);
        done();
      }.bind(this)
    ], allDone);
  });

  it('submits an undoable operation', function(allDone) {
    async.series([
      this.doc.create.bind(this.doc, { test: 5 }),
      this.doc.submitOp.bind(this.doc, [ { p: [ 'test' ], na: 2 } ], { undoable: true }),
      function(done) {
        expect(this.doc.version).to.equal(2);
        expect(this.doc.data).to.eql({ test: 7 });
        expect(this.doc.canUndo()).to.equal(true);
        expect(this.doc.canRedo()).to.equal(false);
        done();
      }.bind(this)
    ], allDone);
  });

  it('undoes an operation', function(allDone) {
    async.series([
      this.doc.create.bind(this.doc, { test: 5 }),
      this.doc.submitOp.bind(this.doc, [ { p: [ 'test' ], na: 2 } ], { undoable: true }),
      this.doc.undo.bind(this.doc),
      function(done) {
        expect(this.doc.version).to.equal(3);
        expect(this.doc.data).to.eql({ test: 5 });
        expect(this.doc.canUndo()).to.equal(false);
        expect(this.doc.canRedo()).to.equal(true);
        done();
      }.bind(this)
    ], allDone);
  });

  it('redoes an operation', function(allDone) {
    async.series([
      this.doc.create.bind(this.doc, { test: 5 }),
      this.doc.submitOp.bind(this.doc, [ { p: [ 'test' ], na: 2 } ], { undoable: true }),
      this.doc.undo.bind(this.doc),
      this.doc.redo.bind(this.doc),
      function(done) {
        expect(this.doc.version).to.equal(4);
        expect(this.doc.data).to.eql({ test: 7 });
        expect(this.doc.canUndo()).to.equal(true);
        expect(this.doc.canRedo()).to.equal(false);
        done();
      }.bind(this)
    ], allDone);
  });

  it('performs a series of undo and redo operations', function(allDone) {
    async.series([
      this.doc.create.bind(this.doc, { test: 5 }),
      this.doc.submitOp.bind(this.doc, [ { p: [ 'test' ], na: 2 } ], { undoable: true }),
      this.doc.undo.bind(this.doc),
      this.doc.redo.bind(this.doc),
      this.doc.undo.bind(this.doc),
      this.doc.redo.bind(this.doc),
      this.doc.undo.bind(this.doc),
      this.doc.redo.bind(this.doc),
      function(done) {
        expect(this.doc.version).to.equal(8);
        expect(this.doc.data).to.eql({ test: 7 });
        expect(this.doc.canUndo()).to.equal(true);
        expect(this.doc.canRedo()).to.equal(false);
        done();
      }.bind(this)
    ], allDone);
  });

  it('performs a series of undo and redo operations synchronously', function() {
    this.doc.create({ test: 5 }),
    this.doc.submitOp([ { p: [ 'test' ], na: 2 } ], { undoable: true }),
    expect(this.doc.data).to.eql({ test: 7 });
    this.doc.undo(),
    expect(this.doc.data).to.eql({ test: 5 });
    this.doc.redo(),
    expect(this.doc.data).to.eql({ test: 7 });
    this.doc.undo(),
    expect(this.doc.data).to.eql({ test: 5 });
    this.doc.redo(),
    expect(this.doc.data).to.eql({ test: 7 });
    this.doc.undo(),
    expect(this.doc.data).to.eql({ test: 5 });
    this.doc.redo(),
    expect(this.doc.data).to.eql({ test: 7 });
    expect(this.doc.canUndo()).to.equal(true);
    expect(this.doc.canRedo()).to.equal(false);
  });

  it('undoes one of two operations', function(allDone) {
    this.doc.undoComposeTimeout = -1;
    async.series([
      this.doc.create.bind(this.doc, { test: 5 }),
      this.doc.submitOp.bind(this.doc, [ { p: [ 'test' ], na: 2 } ], { undoable: true }),
      this.doc.submitOp.bind(this.doc, [ { p: [ 'test' ], na: 3 } ], { undoable: true }),
      this.doc.undo.bind(this.doc),
      function(done) {
        expect(this.doc.version).to.equal(4);
        expect(this.doc.data).to.eql({ test: 7 });
        expect(this.doc.canUndo()).to.equal(true);
        expect(this.doc.canRedo()).to.equal(true);
        done();
      }.bind(this)
    ], allDone);
  });

  it('undoes two of two operations', function(allDone) {
    this.doc.undoComposeTimeout = -1;
    async.series([
      this.doc.create.bind(this.doc, { test: 5 }),
      this.doc.submitOp.bind(this.doc, [ { p: [ 'test' ], na: 2 } ], { undoable: true }),
      this.doc.submitOp.bind(this.doc, [ { p: [ 'test' ], na: 3 } ], { undoable: true }),
      this.doc.undo.bind(this.doc),
      this.doc.undo.bind(this.doc),
      function(done) {
        expect(this.doc.version).to.equal(5);
        expect(this.doc.data).to.eql({ test: 5 });
        expect(this.doc.canUndo()).to.equal(false);
        expect(this.doc.canRedo()).to.equal(true);
        done();
      }.bind(this)
    ], allDone);
  });

  it('reoes one of two operations', function(allDone) {
    this.doc.undoComposeTimeout = -1;
    async.series([
      this.doc.create.bind(this.doc, { test: 5 }),
      this.doc.submitOp.bind(this.doc, [ { p: [ 'test' ], na: 2 } ], { undoable: true }),
      this.doc.submitOp.bind(this.doc, [ { p: [ 'test' ], na: 3 } ], { undoable: true }),
      this.doc.undo.bind(this.doc),
      this.doc.undo.bind(this.doc),
      this.doc.redo.bind(this.doc),
      function(done) {
        expect(this.doc.version).to.equal(6);
        expect(this.doc.data).to.eql({ test: 7 });
        expect(this.doc.canUndo()).to.equal(true);
        expect(this.doc.canRedo()).to.equal(true);
        done();
      }.bind(this)
    ], allDone);
  });

  it('reoes two of two operations', function(allDone) {
    this.doc.undoComposeTimeout = -1;
    async.series([
      this.doc.create.bind(this.doc, { test: 5 }),
      this.doc.submitOp.bind(this.doc, [ { p: [ 'test' ], na: 2 } ], { undoable: true }),
      this.doc.submitOp.bind(this.doc, [ { p: [ 'test' ], na: 3 } ], { undoable: true }),
      this.doc.undo.bind(this.doc),
      this.doc.undo.bind(this.doc),
      this.doc.redo.bind(this.doc),
      this.doc.redo.bind(this.doc),
      function(done) {
        expect(this.doc.version).to.equal(7);
        expect(this.doc.data).to.eql({ test: 10 });
        expect(this.doc.canUndo()).to.equal(true);
        expect(this.doc.canRedo()).to.equal(false);
        done();
      }.bind(this)
    ], allDone);
  });

  it('calls undo, when canUndo is false', function(done) {
    expect(this.doc.canUndo()).to.equal(false);
    this.doc.undo(done);
  });

  it('calls undo, when canUndo is false - no callback', function() {
    expect(this.doc.canUndo()).to.equal(false);
    this.doc.undo();
  });

  it('calls redo, when canRedo is false', function(done) {
    expect(this.doc.canRedo()).to.equal(false);
    this.doc.redo(done);
  });

  it('calls redo, when canRedo is false - no callback', function() {
    expect(this.doc.canRedo()).to.equal(false);
    this.doc.redo();
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
    this.doc.create({ test: 5 });
    this.doc.submitOp([ { p: [ 'test' ], na: 2 } ], { undoable: true });
    this.doc.on('op', function(op, source) {
      expect(source).to.equal('test source');
      done();
    });
    this.doc.undo({ source: 'test source' });
  });

  it('preserves source on redo', function(done) {
    this.doc.create({ test: 5 });
    this.doc.submitOp([ { p: [ 'test' ], na: 2 } ], { undoable: true });
    this.doc.undo();
    this.doc.on('op', function(op, source) {
      expect(source).to.equal('test source');
      done();
    });
    this.doc.redo({ source: 'test source' });
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
    this.doc.create({ test: 5 });
    this.doc.submitOp([ { p: [ 'test' ], na: 2 } ], { undoable: true });
    setTimeout(function() {
      this.doc.submitOp([ { p: [ 'test' ], na: 3 } ], { undoable: true });
      expect(this.doc.data).to.eql({ test: 10 });
      this.doc.undo();
      expect(this.doc.data).to.eql({ test: 5 });
      expect(this.doc.canUndo()).to.equal(false);
      done();
    }.bind(this), 2);
  });

  it('composes undoable operations correctly', function() {
    this.doc.create({ a: 1, b: 2 });
    this.doc.submitOp([ { p: [ 'a' ], od: 1 } ], { undoable: true });
    this.doc.submitOp([ { p: [ 'b' ], od: 2 } ], { undoable: true });
    expect(this.doc.data).to.eql({});
    expect(this.doc.canRedo()).to.equal(false);
    var opCalled = false;
    this.doc.once('op', function(op) {
      opCalled = true;
      expect(op).to.eql([ { p: [ 'b' ], oi: 2 }, { p: [ 'a' ], oi: 1 } ]);
    });
    this.doc.undo();
    expect(opCalled).to.equal(true);
    expect(this.doc.data).to.eql({ a: 1, b: 2 });
    expect(this.doc.canUndo()).to.equal(false);
    this.doc.redo();
    expect(this.doc.data).to.eql({});
    expect(this.doc.canRedo()).to.equal(false);
  });

  it('does not compose undoable operations outside time limit', function(done) {
    this.doc.undoComposeTimeout = 1;
    this.doc.create({ test: 5 });
    this.doc.submitOp([ { p: [ 'test' ], na: 2 } ], { undoable: true });
    setTimeout(function () {
      this.doc.submitOp([ { p: [ 'test' ], na: 3 } ], { undoable: true });
      expect(this.doc.data).to.eql({ test: 10 });
      this.doc.undo();
      expect(this.doc.data).to.eql({ test: 7 });
      expect(this.doc.canUndo()).to.equal(true);
      this.doc.undo();
      expect(this.doc.data).to.eql({ test: 5 });
      expect(this.doc.canUndo()).to.equal(false);
      done();
    }.bind(this), 3);
  });

  it('does not compose undoable operations, if undoComposeTimeout < 0', function() {
    this.doc.undoComposeTimeout = -1;
    this.doc.create({ test: 5 });
    this.doc.submitOp([ { p: [ 'test' ], na: 2 } ], { undoable: true });
    this.doc.submitOp([ { p: [ 'test' ], na: 3 } ], { undoable: true });
    expect(this.doc.data).to.eql({ test: 10 });
    this.doc.undo();
    expect(this.doc.data).to.eql({ test: 7 });
    expect(this.doc.canUndo()).to.equal(true);
    this.doc.undo();
    expect(this.doc.data).to.eql({ test: 5 });
    expect(this.doc.canUndo()).to.equal(false);
  });

  it('does not compose undoable operations, if type does not support compose nor composeSimilar', function() {
    this.doc.create(5, invertibleType.type.uri);
    this.doc.submitOp(2, { undoable: true });
    expect(this.doc.data).to.equal(7);
    this.doc.submitOp(2, { undoable: true });
    expect(this.doc.data).to.equal(9);
    this.doc.undo();
    expect(this.doc.data).to.equal(7);
    this.doc.undo();
    expect(this.doc.data).to.equal(5);
    expect(this.doc.canUndo()).to.equal(false);
    this.doc.redo();
    expect(this.doc.data).to.equal(7);
    this.doc.redo();
    expect(this.doc.data).to.equal(9);
    expect(this.doc.canRedo()).to.equal(false);
  });

  it('uses applyAndInvert, if available', function() {
    this.doc.undoComposeTimeout = -1;
    this.doc.create([], otRichText.type.uri);
    this.doc.submitOp([ otRichText.Action.createInsertText('two') ], { undoable: true });
    expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('two') ]);
    this.doc.submitOp([ otRichText.Action.createInsertText('one') ], { undoable: true });
    expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('onetwo') ]);
    this.doc.undo();
    expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('two') ]);
    this.doc.undo();
    expect(this.doc.data).to.eql([]);
    this.doc.redo();
    expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('two') ]);
    this.doc.redo();
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

  it('fails to submit with fixUpUndoStack, if type is not invertible', function(done) {
    this.doc.create('two', otText.type.uri);
    this.doc.on('error', done);
    this.doc.submitOp([ 'one' ], { fixUpUndoStack: true }, function(err) {
      expect(err.code).to.equal(4025);
      done();
    });
  });

  it('fails to submit with fixUpRedoStack, if type is not invertible', function(done) {
    this.doc.create('two', otText.type.uri);
    this.doc.on('error', done);
    this.doc.submitOp([ 'one' ], { fixUpRedoStack: true }, function(err) {
      expect(err.code).to.equal(4025);
      done();
    });
  });

  it('composes similar operations', function() {
    this.doc.create([], otRichText.type.uri);
    this.doc.submitOp([
      otRichText.Action.createInsertText('one')
    ], { undoable: true });
    this.doc.submitOp([
      otRichText.Action.createRetain(3),
      otRichText.Action.createInsertText('two')
    ], { undoable: true });
    expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('onetwo') ]);
    expect(this.doc.canRedo()).to.equal(false);
    this.doc.undo();
    expect(this.doc.data).to.eql([]);
    expect(this.doc.canUndo()).to.equal(false);
    this.doc.redo();
    expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('onetwo') ]);
    expect(this.doc.canRedo()).to.equal(false);
  });

  it('does not compose dissimilar operations', function() {
    this.doc.create([
      otRichText.Action.createInsertText(' ')
    ], otRichText.type.uri);

    this.doc.submitOp([
      otRichText.Action.createRetain(1),
      otRichText.Action.createInsertText('two')
    ], { undoable: true });
    expect(this.doc.data).to.eql([
      otRichText.Action.createInsertText(' two')
    ]);

    this.doc.submitOp([
      otRichText.Action.createInsertText('one')
    ], { undoable: true });
    expect(this.doc.data).to.eql([
      otRichText.Action.createInsertText('one two')
    ]);

    this.doc.undo();
    expect(this.doc.data).to.eql([
      otRichText.Action.createInsertText(' two')
    ]);

    this.doc.undo();
    expect(this.doc.data).to.eql([
      otRichText.Action.createInsertText(' ')
    ]);

    this.doc.redo();
    expect(this.doc.data).to.eql([
      otRichText.Action.createInsertText(' two')
    ]);

    this.doc.redo();
    expect(this.doc.data).to.eql([
      otRichText.Action.createInsertText('one two')
    ]);
  });

  it('does not add no-ops to the undo stack on undoable operation', function() {
    var opCalled = false;
    this.doc.create([ otRichText.Action.createInsertText('test', [ 'key', 'value' ]) ], otRichText.type.uri);
    this.doc.on('op', function(op, source) {
      expect(op).to.eql([ otRichText.Action.createRetain(4, [ 'key', 'value' ]) ]);
      opCalled = true;
    });
    this.doc.submitOp([ otRichText.Action.createRetain(4, [ 'key', 'value' ]) ], { undoable: true });
    expect(opCalled).to.equal(true);
    expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('test', [ 'key', 'value' ]) ]);
    expect(this.doc.canUndo()).to.eql(false);
    expect(this.doc.canRedo()).to.eql(false);
  });

  it('limits the size of the undo stack', function() {
    this.doc.undoLimit = 2;
    this.doc.undoComposeTimeout = -1;
    this.doc.create({ test: 5 });
    this.doc.submitOp([ { p: [ 'test' ], na: 2 } ], { undoable: true });
    this.doc.submitOp([ { p: [ 'test' ], na: 2 } ], { undoable: true });
    this.doc.submitOp([ { p: [ 'test' ], na: 2 } ], { undoable: true });
    expect(this.doc.data).to.eql({ test: 11 });
    expect(this.doc.canUndo()).to.equal(true);
    this.doc.undo();
    expect(this.doc.canUndo()).to.equal(true);
    this.doc.undo();
    expect(this.doc.canUndo()).to.equal(false);
    this.doc.undo();
    expect(this.doc.data).to.eql({ test: 7 });
  });

  it('limits the size of the undo stack, after adjusting the limit', function() {
    this.doc.undoLimit = 100;
    this.doc.undoComposeTimeout = -1;
    this.doc.create({ test: 5 });
    this.doc.submitOp([ { p: [ 'test' ], na: 2 } ], { undoable: true });
    this.doc.submitOp([ { p: [ 'test' ], na: 2 } ], { undoable: true });
    this.doc.submitOp([ { p: [ 'test' ], na: 2 } ], { undoable: true });
    this.doc.submitOp([ { p: [ 'test' ], na: 2 } ], { undoable: true });
    this.doc.undoLimit = 2;
    this.doc.submitOp([ { p: [ 'test' ], na: 2 } ], { undoable: true });
    expect(this.doc.data).to.eql({ test: 15 });
    expect(this.doc.canUndo()).to.equal(true);
    this.doc.undo();
    expect(this.doc.canUndo()).to.equal(true);
    this.doc.undo();
    expect(this.doc.canUndo()).to.equal(false);
    this.doc.undo();
    expect(this.doc.data).to.eql({ test: 11 });
  });

  it('does not limit the size of the stacks on undo and redo operations', function() {
    this.doc.undoLimit = 100;
    this.doc.undoComposeTimeout = -1;
    this.doc.create({ test: 5 });
    this.doc.submitOp([ { p: [ 'test' ], na: 2 } ], { undoable: true });
    this.doc.submitOp([ { p: [ 'test' ], na: 2 } ], { undoable: true });
    this.doc.submitOp([ { p: [ 'test' ], na: 2 } ], { undoable: true });
    this.doc.submitOp([ { p: [ 'test' ], na: 2 } ], { undoable: true });
    this.doc.submitOp([ { p: [ 'test' ], na: 2 } ], { undoable: true });
    this.doc.undoLimit = 2;
    expect(this.doc.data).to.eql({ test: 15 });
    this.doc.undo();
    this.doc.undo();
    this.doc.undo();
    this.doc.undo();
    this.doc.undo();
    expect(this.doc.data).to.eql({ test: 5 });
    this.doc.redo();
    this.doc.redo();
    this.doc.redo();
    this.doc.redo();
    this.doc.redo();
    expect(this.doc.data).to.eql({ test: 15 });
    this.doc.undo();
    this.doc.undo();
    this.doc.undo();
    this.doc.undo();
    this.doc.undo();
    expect(this.doc.data).to.eql({ test: 5 });
  });

  it('does not compose the next operation after undo', function() {
    this.doc.create({ test: 5 });
    this.doc.undoComposeTimeout = -1;
    this.doc.submitOp([ { p: [ 'test' ], na: 2 } ], { undoable: true }); // not composed
    this.doc.submitOp([ { p: [ 'test' ], na: 2 } ], { undoable: true }); // not composed
    this.doc.undoComposeTimeout = 1000;
    this.doc.undo();
    this.doc.submitOp([ { p: [ 'test' ], na: 2 } ], { undoable: true }); // not composed
    this.doc.submitOp([ { p: [ 'test' ], na: 2 } ], { undoable: true }); // composed
    expect(this.doc.data).to.eql({ test: 11 });
    expect(this.doc.canUndo()).to.equal(true);

    this.doc.undo();
    expect(this.doc.data).to.eql({ test: 7 });
    expect(this.doc.canUndo()).to.equal(true);

    this.doc.undo();
    expect(this.doc.data).to.eql({ test: 5 });
    expect(this.doc.canUndo()).to.equal(false);
  });

  it('does not compose the next operation after undo and redo', function() {
    this.doc.create({ test: 5 });
    this.doc.undoComposeTimeout = -1;
    this.doc.submitOp([ { p: [ 'test' ], na: 2 } ], { undoable: true }); // not composed
    this.doc.submitOp([ { p: [ 'test' ], na: 2 } ], { undoable: true }); // not composed
    this.doc.undoComposeTimeout = 1000;
    this.doc.undo();
    this.doc.redo();
    this.doc.submitOp([ { p: [ 'test' ], na: 2 } ], { undoable: true }); // not composed
    this.doc.submitOp([ { p: [ 'test' ], na: 2 } ], { undoable: true }); // composed
    expect(this.doc.data).to.eql({ test: 13 });
    expect(this.doc.canUndo()).to.equal(true);

    this.doc.undo();
    expect(this.doc.data).to.eql({ test: 9 });
    expect(this.doc.canUndo()).to.equal(true);

    this.doc.undo();
    expect(this.doc.data).to.eql({ test: 7 });
    expect(this.doc.canUndo()).to.equal(true);

    this.doc.undo();
    expect(this.doc.data).to.eql({ test: 5 });
    expect(this.doc.canUndo()).to.equal(false);
  });

  it('clears stacks on del', function() {
    this.doc.undoComposeTimeout = -1;
    this.doc.create({ test: 5 });
    this.doc.submitOp([ { p: [ 'test' ], na: 2 } ], { undoable: true });
    this.doc.submitOp([ { p: [ 'test' ], na: 2 } ], { undoable: true });
    this.doc.undo();
    expect(this.doc.canUndo()).to.equal(true);
    expect(this.doc.canRedo()).to.equal(true);
    this.doc.del();
    expect(this.doc.canUndo()).to.equal(false);
    expect(this.doc.canRedo()).to.equal(false);
  });

  it('transforms the stacks by remote operations', function(done) {
    this.doc2.subscribe();
    this.doc.subscribe();
    this.doc.undoComposeTimeout = -1;
    this.doc.create([], otRichText.type.uri);
    this.doc.submitOp([ otRichText.Action.createInsertText('4') ], { undoable: true });
    this.doc.submitOp([ otRichText.Action.createInsertText('3') ], { undoable: true });
    this.doc.submitOp([ otRichText.Action.createInsertText('2') ], { undoable: true });
    this.doc.submitOp([ otRichText.Action.createInsertText('1') ], { undoable: true });
    this.doc.undo();
    this.doc.undo();
    setTimeout(function() {
      this.doc.once('op', function(op, source) {
        expect(source).to.equal(false);
        expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('ABC34') ]);
        this.doc.undo();
        expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('ABC4') ]);
        this.doc.undo();
        expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('ABC') ]);
        this.doc.redo();
        expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('ABC4') ]);
        this.doc.redo();
        expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('ABC34') ]);
        this.doc.redo();
        expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('ABC234') ]);
        this.doc.redo();
        expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('ABC1234') ]);
        done();
      }.bind(this));
      this.doc2.submitOp([ otRichText.Action.createInsertText('ABC') ]);
    }.bind(this));
  });

  it('transforms the stacks by remote operations and removes no-ops', function(done) {
    this.doc2.subscribe();
    this.doc.subscribe();
    this.doc.undoComposeTimeout = -1;
    this.doc.create([], otRichText.type.uri);
    this.doc.submitOp([ otRichText.Action.createInsertText('4') ], { undoable: true });
    this.doc.submitOp([ otRichText.Action.createInsertText('3') ], { undoable: true });
    this.doc.submitOp([ otRichText.Action.createInsertText('2') ], { undoable: true });
    this.doc.submitOp([ otRichText.Action.createInsertText('1') ], { undoable: true });
    this.doc.undo();
    this.doc.undo();
    setTimeout(function() {
      this.doc.once('op', function(op, source) {
        expect(source).to.equal(false);
        expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('4') ]);
        this.doc.undo();
        expect(this.doc.data).to.eql([]);
        expect(this.doc.canUndo()).to.equal(false);
        this.doc.redo();
        expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('4') ]);
        this.doc.redo();
        expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('24') ]);
        this.doc.redo();
        expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('124') ]);
        expect(this.doc.canRedo()).to.equal(false);
        done();
      }.bind(this));
      this.doc2.submitOp([ otRichText.Action.createDelete(1) ]);
    }.bind(this));
  });

  it('transforms the stacks by a local FIXED operation', function() {
    this.doc.undoComposeTimeout = -1;
    this.doc.create([], otRichText.type.uri);
    this.doc.submitOp([ otRichText.Action.createInsertText('4') ], { undoable: true });
    this.doc.submitOp([ otRichText.Action.createInsertText('3') ], { undoable: true });
    this.doc.submitOp([ otRichText.Action.createInsertText('2') ], { undoable: true });
    this.doc.submitOp([ otRichText.Action.createInsertText('1') ], { undoable: true });
    this.doc.undo();
    this.doc.undo();
    this.doc.submitOp([ otRichText.Action.createInsertText('ABC') ]);
    expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('ABC34') ]);
    this.doc.undo();
    expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('ABC4') ]);
    this.doc.undo();
    expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('ABC') ]);
    this.doc.redo();
    expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('ABC4') ]);
    this.doc.redo();
    expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('ABC34') ]);
    this.doc.redo();
    expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('ABC234') ]);
    this.doc.redo();
    expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('ABC1234') ]);
  });

  it('transforms the stacks by a local FIXED operation and removes no-ops', function() {
    this.doc.undoComposeTimeout = -1;
    this.doc.create([], otRichText.type.uri);
    this.doc.submitOp([ otRichText.Action.createInsertText('4') ], { undoable: true });
    this.doc.submitOp([ otRichText.Action.createInsertText('3') ], { undoable: true });
    this.doc.submitOp([ otRichText.Action.createInsertText('2') ], { undoable: true });
    this.doc.submitOp([ otRichText.Action.createInsertText('1') ], { undoable: true });
    this.doc.undo();
    this.doc.undo();
    this.doc.submitOp([ otRichText.Action.createDelete(1) ]);
    expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('4') ]);
    this.doc.undo();
    expect(this.doc.data).to.eql([]);
    expect(this.doc.canUndo()).to.equal(false);
    this.doc.redo();
    expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('4') ]);
    this.doc.redo();
    expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('24') ]);
    this.doc.redo();
    expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('124') ]);
    expect(this.doc.canRedo()).to.equal(false);
  });

  it('transforms the stacks using transform', function() {
    this.doc.undoComposeTimeout = -1;
    this.doc.create(0, invertibleType.type.uri);
    this.doc.submitOp(1, { undoable: true });
    this.doc.submitOp(10, { undoable: true });
    this.doc.submitOp(100, { undoable: true });
    this.doc.submitOp(1000, { undoable: true });
    this.doc.undo();
    this.doc.undo();
    expect(this.doc.data).to.equal(11);
    this.doc.submitOp(10000);
    this.doc.undo();
    expect(this.doc.data).to.equal(10001);
    this.doc.undo();
    expect(this.doc.data).to.equal(10000);
    this.doc.redo();
    expect(this.doc.data).to.equal(10001);
    this.doc.redo();
    expect(this.doc.data).to.equal(10011);
    this.doc.redo();
    expect(this.doc.data).to.equal(10111);
    this.doc.redo();
    expect(this.doc.data).to.equal(11111);
  });

  it('transforms the stacks using transformX', function() {
    this.doc.undoComposeTimeout = -1;
    this.doc.create(0, invertibleType.typeWithTransformX.uri);
    this.doc.submitOp(1, { undoable: true });
    this.doc.submitOp(10, { undoable: true });
    this.doc.submitOp(100, { undoable: true });
    this.doc.submitOp(1000, { undoable: true });
    this.doc.undo();
    this.doc.undo();
    expect(this.doc.data).to.equal(11);
    this.doc.submitOp(10000);
    this.doc.undo();
    expect(this.doc.data).to.equal(10001);
    this.doc.undo();
    expect(this.doc.data).to.equal(10000);
    this.doc.redo();
    expect(this.doc.data).to.equal(10001);
    this.doc.redo();
    expect(this.doc.data).to.equal(10011);
    this.doc.redo();
    expect(this.doc.data).to.equal(10111);
    this.doc.redo();
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

  describe('operationType', function() {
    it('reports UNDOABLE operationType', function(done) {
      var beforeOpCalled = false;
      this.doc.create({ test: 5 });
      this.doc.on('before op', function(op, source, operationType) {
        expect(source).to.equal(true);
        expect(operationType).to.equal('UNDOABLE');
        beforeOpCalled = true;
      });
      this.doc.on('op', function(op, source, operationType) {
        expect(beforeOpCalled).to.equal(true);
        expect(source).to.equal(true);
        expect(operationType).to.equal('UNDOABLE');
        done();
      });
      this.doc.submitOp([ { p: [ 'test' ], na: 2 } ], { undoable: true });
    });

    it('reports UNDO operationType', function(done) {
      var beforeOpCalled = false;
      this.doc.create({ test: 5 });
      this.doc.submitOp([ { p: [ 'test' ], na: 2 } ], { undoable: true });
      this.doc.on('before op', function(op, source, operationType) {
        expect(source).to.equal(true);
        expect(operationType).to.equal('UNDO');
        beforeOpCalled = true;
      });
      this.doc.on('op', function(op, source, operationType) {
        expect(beforeOpCalled).to.equal(true);
        expect(source).to.equal(true);
        expect(operationType).to.equal('UNDO');
        done();
      });
      this.doc.undo();
    });

    it('reports REDO operationType', function(done) {
      var beforeOpCalled = false;
      this.doc.create({ test: 5 });
      this.doc.submitOp([ { p: [ 'test' ], na: 2 } ], { undoable: true });
      this.doc.undo();
      this.doc.on('before op', function(op, source, operationType) {
        expect(source).to.equal(true);
        expect(operationType).to.equal('REDO');
        beforeOpCalled = true;
      });
      this.doc.on('op', function(op, source, operationType) {
        expect(beforeOpCalled).to.equal(true);
        expect(source).to.equal(true);
        expect(operationType).to.equal('REDO');
        done();
      });
      this.doc.redo();
    });

    it('reports FIXED operationType (local operation, undoable=false)', function(done) {
      var beforeOpCalled = false;
      this.doc.create({ test: 5 });
      this.doc.on('before op', function(op, source, operationType) {
        expect(source).to.equal(true);
        expect(operationType).to.equal('FIXED');
        beforeOpCalled = true;
      });
      this.doc.on('op', function(op, source, operationType) {
        expect(beforeOpCalled).to.equal(true);
        expect(source).to.equal(true);
        expect(operationType).to.equal('FIXED');
        done();
      });
      this.doc.submitOp([ { p: [ 'test' ], na: 2 } ]);
    });

    it('reports FIXED operationType (remote operation, undoable=false)', function(done) {
      var beforeOpCalled = false;
      this.doc.subscribe();
      this.doc.on('before op', function(op, source, operationType) {
        expect(source).to.equal(false);
        expect(operationType).to.equal('FIXED');
        beforeOpCalled = true;
      });
      this.doc.on('op', function(op, source, operationType) {
        expect(beforeOpCalled).to.equal(true);
        expect(source).to.equal(false);
        expect(operationType).to.equal('FIXED');
        done();
      });
      this.doc2.preventCompose = true;
      this.doc2.create({ test: 5 });
      this.doc2.submitOp([ { p: [ 'test' ], na: 2 } ]);
    });

    it('reports FIXED operationType (remote operation, undoable=true)', function(done) {
      var beforeOpCalled = false;
      this.doc.subscribe();
      this.doc.on('before op', function(op, source, operationType) {
        expect(source).to.equal(false);
        expect(operationType).to.equal('FIXED');
        beforeOpCalled = true;
      });
      this.doc.on('op', function(op, source, operationType) {
        expect(beforeOpCalled).to.equal(true);
        expect(source).to.equal(false);
        expect(operationType).to.equal('FIXED');
        done();
      });
      this.doc2.preventCompose = true;
      this.doc2.create({ test: 5 });
      this.doc2.submitOp([ { p: [ 'test' ], na: 2 } ], { undoable: true });
    });
  });

  describe('fixup operations', function() {
    describe('basic tests', function() {
      beforeEach(function() {
        this.assert = function(text) {
          var expected = text ? [ otRichText.Action.createInsertText(text) ] : [];
          expect(this.doc.data).to.eql(expected);
          return this;
        };
        this.submitOp = function(op, options) {
          this.doc.submitOp([ otRichText.Action.createInsertText(op) ], options);
          return this;
        };
        this.submitSnapshot = function(snapshot, options) {
          this.doc.submitSnapshot([ otRichText.Action.createInsertText(snapshot) ], options);
          return this;
        };
        this.undo = function() {
          this.doc.undo();
          return this;
        };
        this.redo = function() {
          this.doc.redo();
          return this;
        };

        this.doc.undoComposeTimeout = -1;
        this.doc.create([], otRichText.type.uri);
        this.submitOp('d', { undoable: true }).assert('d');
        this.submitOp('c', { undoable: true }).assert('cd');
        this.submitOp('b', { undoable: true }).assert('bcd');
        this.submitOp('a', { undoable: true }).assert('abcd');
        this.undo().assert('bcd');
        this.undo().assert('cd');
        expect(this.doc.canUndo()).to.equal(true);
        expect(this.doc.canRedo()).to.equal(true);
      });

      it('submits an operation (transforms undo stack, transforms redo stack)', function() {
        this.submitOp('!').assert('!cd');
        this.undo().assert('!d');
        this.undo().assert('!');
        this.redo().assert('!d');
        this.redo().assert('!cd');
        this.redo().assert('!bcd');
        this.redo().assert('!abcd');
      });

      it('submits an operation (fixes up undo stack, transforms redo stack)', function() {
        this.submitOp('!', { fixUpUndoStack: true }).assert('!cd');
        this.undo().assert('d');
        this.undo().assert('');
        this.redo().assert('d');
        this.redo().assert('!cd');
        this.redo().assert('!bcd');
        this.redo().assert('!abcd');
      });

      it('submits an operation (transforms undo stack, fixes up redo stack)', function() {
        this.submitOp('!', { fixUpRedoStack: true }).assert('!cd');
        this.undo().assert('!d');
        this.undo().assert('!');
        this.redo().assert('!d');
        this.redo().assert('!cd');
        this.redo().assert('bcd');
        this.redo().assert('abcd');
      });

      it('submits an operation (fixes up undo stack, fixes up redo stack)', function() {
        this.submitOp('!', { fixUpUndoStack: true, fixUpRedoStack: true }).assert('!cd');
        this.undo().assert('d');
        this.undo().assert('');
        this.redo().assert('d');
        this.redo().assert('!cd');
        this.redo().assert('bcd');
        this.redo().assert('abcd');
      });

      it('submits a snapshot (transforms undo stack, transforms redo stack)', function() {
        this.submitSnapshot('!cd').assert('!cd');
        this.undo().assert('!d');
        this.undo().assert('!');
        this.redo().assert('!d');
        this.redo().assert('!cd');
        this.redo().assert('!bcd');
        this.redo().assert('!abcd');
      });

      it('submits a snapshot (fixes up undo stack, transforms redo stack)', function() {
        this.submitSnapshot('!cd', { fixUpUndoStack: true }).assert('!cd');
        this.undo().assert('d');
        this.undo().assert('');
        this.redo().assert('d');
        this.redo().assert('!cd');
        this.redo().assert('!bcd');
        this.redo().assert('!abcd');
      });

      it('submits a snapshot (transforms undo stack, fixes up redo stack)', function() {
        this.submitSnapshot('!cd', { fixUpRedoStack: true }).assert('!cd');
        this.undo().assert('!d');
        this.undo().assert('!');
        this.redo().assert('!d');
        this.redo().assert('!cd');
        this.redo().assert('bcd');
        this.redo().assert('abcd');
      });

      it('submits a snapshot (fixes up undo stack, fixes up redo stack)', function() {
        this.submitSnapshot('!cd', { fixUpUndoStack: true, fixUpRedoStack: true }).assert('!cd');
        this.undo().assert('d');
        this.undo().assert('');
        this.redo().assert('d');
        this.redo().assert('!cd');
        this.redo().assert('bcd');
        this.redo().assert('abcd');
      });
    });

    describe('no-ops', function() {
      it('removes a no-op from the undo stack', function() {
        this.doc.undoComposeTimeout = -1;
        this.doc.create([], otRichText.type.uri);
        this.doc.submitOp([ otRichText.Action.createInsertText('d') ], { undoable: true });
        this.doc.submitOp([ otRichText.Action.createInsertText('c') ], { undoable: true });
        this.doc.submitOp([ otRichText.Action.createInsertText('b') ], { undoable: true });
        this.doc.submitOp([ otRichText.Action.createInsertText('a') ], { undoable: true });
        this.doc.undo();
        this.doc.undo();
        expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('cd') ]);
        this.doc.submitOp([ otRichText.Action.createDelete(1) ], { fixUpUndoStack: true });
        expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('d') ]);
        this.doc.undo();
        expect(this.doc.data).to.eql([]);
        expect(this.doc.canUndo()).to.equal(false);
        this.doc.redo();
        expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('d') ]);
        this.doc.redo();
        expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('bd') ]);
        this.doc.redo();
        expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('abd') ]);
        expect(this.doc.canRedo()).to.equal(false);
      });

      it('removes a no-op from the redo stack', function() {
        this.doc.undoComposeTimeout = -1;
        this.doc.create([ otRichText.Action.createInsertText('abcd') ], otRichText.type.uri);
        this.doc.submitOp([ otRichText.Action.createDelete(1) ], { undoable: true });
        this.doc.submitOp([ otRichText.Action.createDelete(1) ], { undoable: true });
        this.doc.submitOp([ otRichText.Action.createDelete(1) ], { undoable: true });
        this.doc.submitOp([ otRichText.Action.createDelete(1) ], { undoable: true });
        this.doc.undo();
        this.doc.undo();
        expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('cd') ]);
        this.doc.submitOp([ otRichText.Action.createDelete(1) ], { fixUpRedoStack: true });
        expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('d') ]);
        this.doc.redo();
        expect(this.doc.data).to.eql([]);
        expect(this.doc.canRedo()).to.equal(false);
        this.doc.undo();
        expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('d') ]);
        this.doc.undo();
        expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('bd') ]);
        this.doc.undo();
        expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('abd') ]);
        expect(this.doc.canUndo()).to.equal(false);
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
        this.doc.on('op', function(op, source) {
          expect(op).to.eql([ otRichText.Action.createInsertText('abc') ]);
          expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('abcdef') ]);
          expect(this.doc.canUndo()).to.equal(false);
          expect(this.doc.canRedo()).to.equal(false);
          expect(source).to.equal('test');
          done();
        }.bind(this));
        this.doc.create([ otRichText.Action.createInsertText('def') ], otRichText.type.uri);
        this.doc.submitSnapshot([ otRichText.Action.createInsertText('abcdef') ], { source: 'test' });
      });

      it('submits a snapshot with source (with callback)', function(done) {
        var opEmitted = false;
        this.doc.on('op', function(op, source) {
          expect(op).to.eql([ otRichText.Action.createInsertText('abc') ]);
          expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('abcdef') ]);
          expect(source).to.equal('test');
          expect(this.doc.canUndo()).to.equal(false);
          expect(this.doc.canRedo()).to.equal(false);
          opEmitted = true;
        }.bind(this));
        this.doc.create([ otRichText.Action.createInsertText('def') ], otRichText.type.uri);
        this.doc.submitSnapshot([ otRichText.Action.createInsertText('abcdef') ], { source: 'test' }, function(error) {
          expect(opEmitted).to.equal(true);
          done(error);
        });
      });

      it('submits a snapshot without source (no callback)', function(done) {
        this.doc.on('op', function(op, source) {
          expect(op).to.eql([ otRichText.Action.createInsertText('abc') ]);
          expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('abcdef') ]);
          expect(this.doc.canUndo()).to.equal(false);
          expect(this.doc.canRedo()).to.equal(false);
          expect(source).to.equal(true);
          done();
        }.bind(this));
        this.doc.create([ otRichText.Action.createInsertText('def') ], otRichText.type.uri);
        this.doc.submitSnapshot([ otRichText.Action.createInsertText('abcdef') ]);
      });

      it('submits a snapshot without source (with callback)', function(done) {
        var opEmitted = false;
        this.doc.on('op', function(op, source) {
          expect(op).to.eql([ otRichText.Action.createInsertText('abc') ]);
          expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('abcdef') ]);
          expect(source).to.equal(true);
          expect(this.doc.canUndo()).to.equal(false);
          expect(this.doc.canRedo()).to.equal(false);
          opEmitted = true;
        }.bind(this));
        this.doc.create([ otRichText.Action.createInsertText('def') ], otRichText.type.uri);
        this.doc.submitSnapshot([ otRichText.Action.createInsertText('abcdef') ], function(error) {
          expect(opEmitted).to.equal(true);
          done(error);
        });
      });

      it('submits snapshots and supports undo and redo', function() {
        this.doc.undoComposeTimeout = -1;
        this.doc.create([ otRichText.Action.createInsertText('ghi') ], otRichText.type.uri);
        this.doc.submitSnapshot([ otRichText.Action.createInsertText('defghi') ], { undoable: true });
        expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('defghi') ]);
        this.doc.submitSnapshot([ otRichText.Action.createInsertText('abcdefghi') ], { undoable: true });
        expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('abcdefghi') ]);
        this.doc.undo();
        expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('defghi') ]);
        this.doc.undo();
        expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('ghi') ]);
        expect(this.doc.canUndo()).to.equal(false);
        this.doc.redo();
        expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('defghi') ]);
        this.doc.redo();
        expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('abcdefghi') ]);
        expect(this.doc.canRedo()).to.equal(false);
        this.doc.undo();
        expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('defghi') ]);
        this.doc.undo();
        expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('ghi') ]);
        expect(this.doc.canUndo()).to.equal(false);
      });

      it('submits snapshots and composes operations', function() {
        this.doc.create([ otRichText.Action.createInsertText('ghi') ], otRichText.type.uri);
        this.doc.submitSnapshot([ otRichText.Action.createInsertText('defghi') ], { undoable: true });
        expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('defghi') ]);
        this.doc.submitSnapshot([ otRichText.Action.createInsertText('abcdefghi') ], { undoable: true });
        expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('abcdefghi') ]);
        this.doc.undo();
        expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('ghi') ]);
        expect(this.doc.canUndo()).to.equal(false);
        this.doc.redo();
        expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('abcdefghi') ]);
        expect(this.doc.canRedo()).to.equal(false);
        this.doc.undo();
        expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('ghi') ]);
        expect(this.doc.canUndo()).to.equal(false);
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
        this.doc.undoComposeTimeout = -1;
        this.doc.create([], otRichText.type.uri);
        this.doc.submitSnapshot([ otRichText.Action.createInsertText('a') ], { undoable: true });
        this.doc.submitSnapshot([ otRichText.Action.createInsertText('ab') ], { undoable: true });
        this.doc.submitSnapshot([ otRichText.Action.createInsertText('abc') ], { undoable: true });
        this.doc.submitSnapshot([ otRichText.Action.createInsertText('abcd') ], { undoable: true });
        this.doc.submitSnapshot([ otRichText.Action.createInsertText('abcde') ], { undoable: true });
        this.doc.submitSnapshot([ otRichText.Action.createInsertText('abcdef') ], { undoable: true });
        this.doc.undo();
        this.doc.undo();
        expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('abcd') ]);
        this.doc.submitSnapshot([ otRichText.Action.createInsertText('abc123d') ]);
        expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('abc123d') ]);
        this.doc.undo();
        expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('abc123') ]);
        this.doc.undo();
        expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('ab123') ]);
        this.doc.undo();
        expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('a123') ]);
        this.doc.undo();
        expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('123') ]);
        this.doc.redo();
        expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('a123') ]);
        this.doc.redo();
        expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('ab123') ]);
        this.doc.redo();
        expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('abc123') ]);
        this.doc.redo();
        expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('abc123d') ]);
        this.doc.redo();
        expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('abc123de') ]);
        this.doc.redo();
        expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('abc123def') ]);
      });

      it('submits a snapshot without a diffHint', function() {
        var opCalled = 0;
        this.doc.create([ otRichText.Action.createInsertText('aaaa') ], otRichText.type.uri);
        this.doc.submitSnapshot([ otRichText.Action.createInsertText('aaaaa') ], { undoable: true });
        expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('aaaaa') ]);

        this.doc.once('op', function(op) {
          expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('aaaa') ]);
          expect(op).to.eql([ otRichText.Action.createDelete(1) ]);
          opCalled++;
        }.bind(this));
        this.doc.undo();

        this.doc.once('op', function(op) {
          expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('aaaaa') ]);
          expect(op).to.eql([ otRichText.Action.createInsertText('a') ]);
          opCalled++;
        }.bind(this));
        this.doc.redo();

        expect(opCalled).to.equal(2);
      });

      it('submits a snapshot with a diffHint', function() {
        var opCalled = 0;
        this.doc.create([ otRichText.Action.createInsertText('aaaa') ], otRichText.type.uri);
        this.doc.submitSnapshot([ otRichText.Action.createInsertText('aaaaa') ], { undoable: true, diffHint: 2 });
        expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('aaaaa') ]);

        this.doc.once('op', function(op) {
          expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('aaaa') ]);
          expect(op).to.eql([ otRichText.Action.createRetain(2), otRichText.Action.createDelete(1) ]);
          opCalled++;
        }.bind(this));
        this.doc.undo();

        this.doc.once('op', function(op) {
          expect(this.doc.data).to.eql([ otRichText.Action.createInsertText('aaaaa') ]);
          expect(op).to.eql([ otRichText.Action.createRetain(2), otRichText.Action.createInsertText('a') ]);
          opCalled++;
        }.bind(this));
        this.doc.redo();

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
        this.doc.create(5, invertibleType.typeWithDiff.uri);
        this.doc.submitSnapshot(7);
        expect(this.doc.data).to.equal(7);
        expect(this.doc.canUndo()).to.equal(false);
        expect(this.doc.canRedo()).to.equal(false);
      });
      it('submits a snapshot (undoable)', function() {
        this.doc.create(5, invertibleType.typeWithDiff.uri);
        this.doc.submitSnapshot(7, { undoable: true });
        expect(this.doc.data).to.equal(7);
        this.doc.undo();
        expect(this.doc.data).to.equal(5);
        this.doc.redo();
        expect(this.doc.data).to.equal(7);
      });
    });

    describe('with diffX', function () {
      it('submits a snapshot (non-undoable)', function() {
        this.doc.create(5, invertibleType.typeWithDiffX.uri);
        this.doc.submitSnapshot(7);
        expect(this.doc.data).to.equal(7);
        expect(this.doc.canUndo()).to.equal(false);
        expect(this.doc.canRedo()).to.equal(false);
      });
      it('submits a snapshot (undoable)', function() {
        this.doc.create(5, invertibleType.typeWithDiffX.uri);
        this.doc.submitSnapshot(7, { undoable: true });
        expect(this.doc.data).to.equal(7);
        this.doc.undo();
        expect(this.doc.data).to.equal(5);
        this.doc.redo();
        expect(this.doc.data).to.equal(7);
      });
    });

    describe('with diff and diffX', function () {
      it('submits a snapshot (non-undoable)', function() {
        this.doc.create(5, invertibleType.typeWithDiffAndDiffX.uri);
        this.doc.submitSnapshot(7);
        expect(this.doc.data).to.equal(7);
        expect(this.doc.canUndo()).to.equal(false);
        expect(this.doc.canRedo()).to.equal(false);
      });
      it('submits a snapshot (undoable)', function() {
        this.doc.create(5, invertibleType.typeWithDiffAndDiffX.uri);
        this.doc.submitSnapshot(7, { undoable: true });
        expect(this.doc.data).to.equal(7);
        this.doc.undo();
        expect(this.doc.data).to.equal(5);
        this.doc.redo();
        expect(this.doc.data).to.equal(7);
      });
    });
  });
});
