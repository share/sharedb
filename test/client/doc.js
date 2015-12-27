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

});
