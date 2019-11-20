var ShareDBError = require('../lib/error');
var expect = require('chai').expect;

describe('ShareDBError', function() {
  it('can be identified by instanceof', function() {
    var error = new ShareDBError();
    expect(error).to.be.instanceof(ShareDBError);
  });

  it('has a code', function() {
    var error = new ShareDBError('ERROR_CODE');
    expect(error.code).to.equal('ERROR_CODE');
  });

  it('has a message', function() {
    var error = new ShareDBError(null, 'Detailed message');
    expect(error.message).to.equal('Detailed message');
  });

  it('has a stack trace', function() {
    function badFunction() {
      throw new ShareDBError();
    }

    try {
      badFunction();
    } catch (error) {
      expect(error.stack).to.contain('badFunction');
    }
  });
});
