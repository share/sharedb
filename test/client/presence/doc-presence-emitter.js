var Backend = require('../../../lib/backend');
var errorHandler = require('../../util').errorHandler;
var expect = require('chai').expect;

describe('DocPresenceEmitter', function() {
  var backend;
  var connection;
  var doc;
  var emitter;

  beforeEach(function(done) {
    backend = new Backend();
    connection = backend.connect();
    doc = connection.get('books', 'northern-lights');
    doc.create({title: 'Northern Lights'}, done);
    emitter = connection._docPresenceEmitter;
  });

  it('listens to an op event', function(done) {
    emitter.addEventListener(doc, 'op', function(op) {
      expect(op).to.eql([{p: ['author'], oi: 'Philip Pullman'}]);
      done();
    });

    doc.submitOp([{p: ['author'], oi: 'Philip Pullman'}], errorHandler(done));
  });

  it('stops listening to events', function(done) {
    var listener = function() {
      done(new Error('should not reach'));
    };

    emitter.addEventListener(doc, 'op', listener);
    emitter.removeEventListener(doc, 'op', listener);

    doc.submitOp([{p: ['author'], oi: 'Philip Pullman'}], done);
  });

  it('removes the listener from the doc if there are no more listeners', function() {
    expect(doc._eventsCount).to.equal(0);
    var listener = function() {};

    emitter.addEventListener(doc, 'op', listener);

    expect(doc._eventsCount).to.be.greaterThan(0);
    expect(emitter._docs).not.to.be.empty;
    expect(emitter._emitters).not.to.be.empty;
    expect(emitter._forwarders).not.to.be.empty;

    emitter.removeEventListener(doc, 'op', listener);

    expect(doc._eventsCount).to.equal(0);
    expect(emitter._docs).to.be.empty;
    expect(emitter._emitters).to.be.empty;
    expect(emitter._forwarders).to.be.empty;
  });

  it('only registers a single listener on the doc', function() {
    expect(doc._eventsCount).to.equal(0);
    var listener = function() { };
    emitter.addEventListener(doc, 'op', listener);
    var count = doc._eventsCount;
    emitter.addEventListener(doc, 'op', listener);
    expect(doc._eventsCount).to.equal(count);
  });

  it('only triggers the given event', function(done) {
    emitter.addEventListener(doc, 'op', function(op) {
      expect(op).to.eql([{p: ['author'], oi: 'Philip Pullman'}]);
      done();
    });

    emitter.addEventListener(doc, 'del', function() {
      done(new Error('should not reach'));
    });

    doc.submitOp([{p: ['author'], oi: 'Philip Pullman'}], errorHandler(done));
  });

  it('removes listeners on destroy', function(done) {
    expect(doc._eventsCount).to.equal(0);
    var listener = function() { };

    emitter.addEventListener(doc, 'op', listener);

    expect(doc._eventsCount).to.be.greaterThan(0);
    expect(emitter._docs).not.to.be.empty;
    expect(emitter._emitters).not.to.be.empty;
    expect(emitter._forwarders).not.to.be.empty;

    doc.destroy(function(error) {
      if (error) return done(error);
      expect(doc._eventsCount).to.equal(0);
      expect(emitter._docs).to.be.empty;
      expect(emitter._emitters).to.be.empty;
      expect(emitter._forwarders).to.be.empty;
      done();
    });
  });
});
