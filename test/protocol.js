var protocol = require('../lib/protocol');
var expect = require('chai').expect;

describe('protocol', function() {
  describe('checkAtLeast', function() {
    var FIXTURES = [
      ['1.0', '1.0', true],
      ['1.1', '1.0', true],
      ['1.0', '1.1', false],
      ['1.0', '1', true],
      ['1.10', '1.3', true],
      ['2.0', '1.3', true],
      [{major: 1, minor: 0}, {major: 1, minor: 0}, true],
      [{major: 1, minor: 1}, {major: 1, minor: 0}, true],
      [{major: 1, minor: 0}, {major: 1, minor: 1}, false],
      [{protocol: 1, protocolMinor: 0}, {protocol: 1, protocolMinor: 0}, true],
      [{protocol: 1, protocolMinor: 1}, {protocol: 1, protocolMinor: 0}, true],
      [{protocol: 1, protocolMinor: 0}, {protocol: 1, protocolMinor: 1}, false],
      [{}, '1.0', false],
      ['', '1.0', false]
    ];

    FIXTURES.forEach(function(fixture) {
      var is = fixture[2] ? ' is ' : ' is not ';
      var name = 'checks ' + JSON.stringify(fixture[0]) + is + 'at least ' + JSON.stringify(fixture[1]);
      it(name, function() {
        expect(protocol.checkAtLeast(fixture[0], fixture[1])).to.equal(fixture[2]);
      });
    });
  });
});
