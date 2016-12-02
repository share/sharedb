var Backend = require('../../lib/backend');
var expect = require('expect.js');

describe('client query subscribe', function() {

  beforeEach(function() {
    this.backend = new Backend();
    this.connection = this.backend.connect();
  });

  it('getting twice returns the same doc', function() {
    var doc = this.connection.get('dogs', 'fido');
    var doc2 = this.connection.get('dogs', 'fido');
    expect(doc).equal(doc2);
  });

  it('calling doc.destroy unregisters it', function() {
    var doc = this.connection.get('dogs', 'fido');
    expect(this.connection.getExisting('dogs', 'fido')).equal(doc);

    doc.destroy();
    expect(this.connection.getExisting('dogs', 'fido')).equal(undefined);

    var doc2 = this.connection.get('dogs', 'fido');
    expect(doc).not.equal(doc2);
  });

  it('getting then destroying then getting returns a new doc object', function() {
    var doc = this.connection.get('dogs', 'fido');
    doc.destroy();
    var doc2 = this.connection.get('dogs', 'fido');
    expect(doc).not.equal(doc2);
    expect(doc).eql(doc2);
  });

  it('doc.destroy() calls back', function(done) {
    var doc = this.connection.get('dogs', 'fido');
    doc.destroy(done);
  });

  describe('applyStack', function() {

    beforeEach(function(done) {
      this.doc = this.connection.get('dogs', 'fido');
      this.doc2 = this.backend.connect().get('dogs', 'fido');
      this.doc3 = this.backend.connect().get('dogs', 'fido');
      var doc2 = this.doc2;
      this.doc.create({}, function(err) {
        if (err) return done(err);
        doc2.fetch(done);
      });
    });

    function verifyConsistency(doc, doc2, doc3, handlers, callback) {
      doc.whenNothingPending(function(err) {
        if (err) return callback(err);
        expect(handlers.length).equal(0);
        doc2.fetch(function(err) {
          if (err) return callback(err);
          doc3.fetch(function(err) {
            if (err) return callback(err);
            expect(doc.data).eql(doc2.data);
            expect(doc.data).eql(doc3.data);
            callback();
          });
        });
      });
    }

    it('single component ops emit an `op` event', function(done) {
      var doc = this.doc;
      var doc2 = this.doc2;
      var doc3 = this.doc3;
      var handlers = [
        function(op, source) {
          expect(source).equal(true);
          expect(op).eql([{p: ['color'], oi: 'white'}]);
          expect(doc.data).eql({color: 'white'});
          doc.submitOp({p: ['color'], oi: 'gray'});
        }, function(op, source) {
          expect(source).equal(true);
          expect(op).eql([{p: ['color'], oi: 'gray'}]);
          expect(doc.data).eql({color: 'gray'});
        }, function(op, source) {
          expect(source).equal(false);
          expect(op).eql([]);
          expect(doc.data).eql({color: 'gray'});
          doc.submitOp({p: ['color'], oi: 'black'});
        }, function(op, source) {
          expect(source).equal(true);
          expect(op).eql([{p: ['color'], oi: 'black'}]);
          expect(doc.data).eql({color: 'black'});
        }
      ];
      doc.on('op', function(op, source) {
        var handler = handlers.shift();
        handler(op, source);
      });
      doc2.submitOp([{p: ['color'], oi: 'brown'}], function(err) {
        if (err) return done(err);
        doc.submitOp({p: ['color'], oi: 'white'});
        expect(doc.data).eql({color: 'gray'});
        verifyConsistency(doc, doc2, doc3, handlers, done);
      });
    });

    it('remote multi component ops emit individual `op` events', function(done) {
      var doc = this.doc;
      var doc2 = this.doc2;
      var doc3 = this.doc3;
      var handlers = [
        function(op, source) {
          expect(source).equal(true);
          expect(op).eql([{p: ['color'], oi: 'white'}]);
          expect(doc.data).eql({color: 'white'});
          doc.submitOp([{p: ['color'], oi: 'gray'}, {p: ['weight'], oi: 40}]);
          expect(doc.data).eql({color: 'gray', weight: 40});
        }, function(op, source) {
          expect(source).equal(true);
          expect(op).eql([{p: ['color'], oi: 'gray'}, {p: ['weight'], oi: 40}]);
          expect(doc.data).eql({color: 'gray', weight: 40});
        }, function(op, source) {
          expect(source).equal(false);
          expect(op).eql([{p: ['age'], oi: 2}]);
          expect(doc.data).eql({color: 'gray', weight: 40, age: 2});
          doc.submitOp([{p: ['color'], oi: 'black'}, {p: ['age'], na: 1}]);
          expect(doc.data).eql({color: 'black', weight: 40, age: 5});
        }, function(op, source) {
          expect(source).equal(true);
          expect(op).eql([{p: ['color'], oi: 'black'}, {p: ['age'], na: 1}]);
          expect(doc.data).eql({color: 'black', weight: 40, age: 3});
          doc.submitOp({p: ['age'], na: 2});
          expect(doc.data).eql({color: 'black', weight: 40, age: 5});
        }, function(op, source) {
          expect(source).equal(true);
          expect(op).eql([{p: ['age'], na: 2}]);
          expect(doc.data).eql({color: 'black', weight: 40, age: 5});
        }, function(op, source) {
          expect(source).equal(false);
          expect(op).eql([{p: ['owner'], oi: 'sue'}]);
          expect(doc.data).eql({color: 'black', weight: 40, age: 5, owner: 'sue'});
        }
      ];
      doc.on('op', function(op, source) {
        var handler = handlers.shift();
        handler(op, source);
      });
      doc2.submitOp([{p: ['age'], oi: 2}, {p: ['owner'], oi: 'sue'}], function(err) {
        if (err) return done(err);
        doc.submitOp({p: ['color'], oi: 'white'});
        expect(doc.data).eql({color: 'gray', weight: 40});
        verifyConsistency(doc, doc2, doc3, handlers, done);
      });
    });

    it('remote multi component ops are transformed by ops submitted in `op` event handlers', function(done) {
      var doc = this.doc;
      var doc2 = this.doc2;
      var doc3 = this.doc3;
      var handlers = [
        function(op, source) {
          expect(source).equal(false);
          expect(op).eql([{p: ['tricks'], oi: ['fetching']}]);
          expect(doc.data).eql({tricks: ['fetching']});
        }, function(op, source) {
          expect(source).equal(false);
          expect(op).eql([{p: ['tricks', 0], li: 'stand'}]);
          expect(doc.data).eql({tricks: ['stand', 'fetching']});
          doc.submitOp([{p: ['tricks', 0], ld: 'stand'}, {p: ['tricks', 0, 8], si: ' stick'}]);
          expect(doc.data).eql({tricks: ['fetching stick']});
        }, function(op, source) {
          expect(source).equal(true);
          expect(op).eql([{p: ['tricks', 0], ld: 'stand'}, {p: ['tricks', 0, 8], si: ' stick'}]);
          expect(doc.data).eql({tricks: ['fetching stick']});
        }, function(op, source) {
          expect(source).equal(false);
          expect(op).eql([{p: ['tricks', 0], li: 'shake'}]);
          expect(doc.data).eql({tricks: ['shake', 'fetching stick']});
          doc.submitOp([{p: ['tricks', 1, 0], sd: 'fetch'}, {p: ['tricks', 1, 0], si: 'tug'}]);
          expect(doc.data).eql({tricks: ['shake', 'tuging stick']});
        }, function(op, source) {
          expect(source).equal(true);
          expect(op).eql([{p: ['tricks', 1, 0], sd: 'fetch'}, {p: ['tricks', 1, 0], si: 'tug'}]);
          expect(doc.data).eql({tricks: ['shake', 'tuging stick']});
        }, function(op, source) {
          expect(source).equal(false);
          expect(op).eql([{p: ['tricks', 1, 3], sd: 'ing'}]);
          expect(doc.data).eql({tricks: ['shake', 'tug stick']});
        }, function(op, source) {
          expect(source).equal(false);
          expect(op).eql([]);
          expect(doc.data).eql({tricks: ['shake', 'tug stick']});
        }
      ];
      doc.on('op', function(op, source) {
        var handler = handlers.shift();
        handler(op, source);
      });
      var remoteOp = [
        {p: ['tricks'], oi: ['fetching']},
        {p: ['tricks', 0], li: 'stand'},
        {p: ['tricks', 1], li: 'shake'},
        {p: ['tricks', 2, 5], sd: 'ing'},
        {p: ['tricks', 0], lm: 2}
      ];
      doc2.submitOp(remoteOp, function(err) {
        if (err) return done(err);
        doc.fetch();
        verifyConsistency(doc, doc2, doc3, handlers, done);
      });
    });

  });

});
