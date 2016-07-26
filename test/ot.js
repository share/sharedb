var expect = require('expect.js');
var ot = require('../lib/ot');
var type = require('../lib/types').defaultType;

describe('ot', function() {

  describe('checkOp', function() {
    it('fails if op is not an object', function() {
      expect(ot.checkOp('hi')).ok();
      expect(ot.checkOp()).ok();
      expect(ot.checkOp(123)).ok();
      expect(ot.checkOp([])).ok();
    });

    it('fails if op data is missing op, create and del', function() {
      expect(ot.checkOp({v: 5})).ok();
    });

    it('fails if src/seq data is invalid', function() {
      expect(ot.checkOp({del: true, v: 5, src: 'hi'})).ok();
      expect(ot.checkOp({del: true, v: 5, seq: 123})).ok();
      expect(ot.checkOp({del: true, v: 5, src: 'hi', seq: 'there'})).ok();
    });

    it('fails if a create operation is missing its type', function() {
      expect(ot.checkOp({create: {}})).ok();
      expect(ot.checkOp({create: 123})).ok();
    });

    it('fails if the type is missing', function() {
      expect(ot.checkOp({create:{type: 'something that does not exist'}})).ok();
    });

    it('accepts valid create operations', function() {
      expect(ot.checkOp({create: {type: type.uri}})).equal();
      expect(ot.checkOp({create: {type: type.uri, data: 'hi there'}})).equal();
    });

    it('accepts valid delete operations', function() {
      expect(ot.checkOp({del:true})).equal();
    });

    it('accepts valid ops', function() {
      expect(ot.checkOp({op:[1,2,3]})).equal();
    });
  });

  describe('normalize', function() {
    it('expands type names in normalizeType', function() {
      expect(ot.normalizeType(type.name)).equal(type.uri);
      expect(ot.normalizeType(type.uri)).equal(type.uri);
      expect(ot.normalizeType('foo')).equal();
    });
  });

  describe('apply', function() {
    it('fails if the versions dont match', function() {
      expect(ot.apply({v: 0}, {v: 1, create: {type: type.uri}})).ok();
      expect(ot.apply({v: 0}, {v: 1, del: true})).ok();
      expect(ot.apply({v: 0}, {v: 1, op: []})).ok();
      expect(ot.apply({v: 5}, {v: 4, create: {type: type.uri}})).ok();
      expect(ot.apply({v: 5}, {v: 4, del: true})).ok();
      expect(ot.apply({v: 5}, {v: 4, op: []})).ok();
    });

    it('allows the version field to be missing', function() {
      expect(ot.apply({v: 5}, {create: {type: type.uri}})).equal();
      expect(ot.apply({}, {v: 6, create: {type: type.uri}})).equal();
    });
  });

  describe('create', function() {
    it('fails if the document already exists', function() {
      var doc = {v: 6, create: {type: type.uri}};
      expect(ot.apply({v: 6, type: type.uri, data: 'hi'}, doc)).ok();
      // The doc should be unmodified
      expect(doc).eql({v: 6, create: {type: type.uri}});
    });

    it('creates doc data correctly when no initial data is passed', function() {
      var doc = {v: 5};
      expect(ot.apply(doc, {v: 5, create: {type: type.uri}})).equal();
      expect(doc).eql({v: 6, type: type.uri, data: type.create()});
    });

    it('creates doc data when it is given initial data', function() {
      var doc = {v: 5};
      expect(ot.apply(doc, {v: 5, create: {type: type.uri, data: 'Hi there'}})).equal();
      expect(doc).eql({v: 6, type: type.uri, data: 'Hi there'});
    });
  });

  describe('del', function() {
    it('deletes the document data and type', function() {
      var doc = {v: 6, type: type.uri, data: 'Hi there'};
      expect(ot.apply(doc, {v: 6, del: true})).equal();
      expect(doc).eql({v: 7, type: null, data: undefined});
    });

    it('still works if the document doesnt exist anyway', function() {
      var doc = {v: 6};
      expect(ot.apply(doc, {v: 6, del: true})).equal();
      expect(doc).eql({v: 7, type: null, data: undefined});
    });
  });

  describe('op', function() {
    it('fails if the document does not exist', function() {
      expect(ot.apply({v: 6}, {v: 6, op: [1,2,3]})).ok();
    });

    it('fails if the type is missing', function() {
      expect(ot.apply({v: 6, type: 'some non existant type'}, {v: 6, op: [1,2,3]})).ok();
    });

    it('applies the operation to the document data', function() {
      var doc = {v: 6, type: type.uri, data: 'Hi'};
      expect(ot.apply(doc, {v: 6, op: [{p: [2], si: ' there'}]})).equal();
      expect(doc).eql({v: 7, type: type.uri, data: 'Hi there'});
    });
  });

  describe('no-op', function() {
    it('works on existing docs', function() {
      var doc = {v: 6, type: type.uri, data: 'Hi'};
      expect(ot.apply(doc, {v: 6})).equal();
      // same, but with v+1.
      expect(doc).eql({v: 7, type: type.uri, data: 'Hi'});
    });

    it('works on nonexistant docs', function() {
      var doc = {v: 0};
      expect(ot.apply(doc, {v: 0})).equal();
      expect(doc).eql({v: 1});
    });
  });

  describe('transform', function() {
    it('fails if the version is specified on both and does not match', function() {
      var op1 = {v: 5, op: [{p: [10], si: 'hi'}]};
      var op2 = {v: 6, op: [{p: [5], si: 'abcde'}]};
      expect(ot.transform(type.uri, op1, op2)).ok();
      expect(op1).eql({v: 5, op: [{p: [10], si: 'hi'}]});
    });

    // There's 9 cases here.
    it('create by create fails', function() {
      expect(ot.transform(null, {v: 10, create: {type: type.uri}}, {v: 10, create: {type: type.uri}})).ok();
    });

    it('create by delete fails', function() {
      expect(ot.transform(null, {create: {type: type.uri}}, {del: true})).ok();
    });

    it('create by op fails', function() {
      expect(ot.transform(null, {v: 10, create: {type: type.uri}}, {v: 10, op: [15, 'hi']})).ok();
    });

    it('create by noop ok', function() {
      var op = {create: {type: type.uri}, v: 6};
      expect(ot.transform(null, op, {v: 6})).equal();
      expect(op).eql({create: {type: type.uri}, v: 7});
    });

    it('delete by create fails', function() {
      expect(ot.transform(null, {del: true}, {create: {type: type.uri}})).ok();
    });

    it('delete by delete ok', function() {
      var op = {del: true, v: 6};
      expect(ot.transform(type.uri, op, {del: true, v: 6})).equal();
      expect(op).eql({del: true, v: 7});

      // And with no version specified should work, too
      var op = {del: true};
      expect(ot.transform(type.uri, op, {del: true, v: 6})).equal();
      expect(op).eql({del: true});
    });

    it('delete by op ok', function() {
      var op = {del: true, v: 8};
      expect(ot.transform(type.uri, op, {op: [], v: 8}));
      expect(op).eql({del: true, v: 9});

      // And with no version specified should work, too
      var op = {del: true};
      expect(ot.transform(type.uri, op, {op: [], v: 8}));
      expect(op).eql({del: true});
    });

    it('delete by noop ok', function() {
      var op = {del: true, v: 6};
      expect(ot.transform(null, op, {v: 6})).equal();
      expect(op).eql({del: true, v: 7});

      var op = {del: true};
      expect(ot.transform(null, op, {v: 6})).equal();
      expect(op).eql({del: true});
    });

    it('op by create fails', function() {
      expect(ot.transform(null, {op: {}}, {create: {type: type.uri}})).ok();
    });

    it('op by delete fails', function() {
      expect(ot.transform(type.uri, {v: 10, op: []}, {v: 10, del: true})).ok();
    });

    it('op by op ok', function() {
      var op1 = {v: 6, op: [{p: [10], si: 'hi'}]};
      var op2 = {v: 6, op: [{p: [5], si: 'abcde'}]};
      expect(ot.transform(type.uri, op1, op2)).equal();
      expect(op1).eql({v: 7, op: [{p: [15], si: 'hi'}]});

      // No version specified
      var op1 = {op: [{p: [10], si: 'hi'}]};
      var op2 = {v: 6, op: [{p: [5], si: 'abcde'}]};
      expect(ot.transform(type.uri, op1, op2)).equal();
      expect(op1).eql({op: [{p: [15], si: 'hi'}]});
    });

    it('op by noop ok', function() {
      // I don't think this is ever used, but whatever.
      var op = {v: 6, op: [{p: [10], si: 'hi'}]};
      expect(ot.transform(type.uri, op, {v: 6})).equal();
      expect(op).eql({v: 7, op: [{p: [10], si: 'hi'}]});
    });

    it('noop by anything is ok', function() {
      var op = {};
      expect(ot.transform(type.uri, op, {v: 6, op: [{p: [10], si: 'hi'}]})).equal();
      expect(op).eql({});
      expect(ot.transform(type.uri, op, {del: true})).equal();
      expect(op).eql({});
      expect(ot.transform(null, op, {create: {type: type.uri}})).equal();
      expect(op).eql({});
      expect(ot.transform(null, op, {})).equal();
      expect(op).eql({});
    });
  });

});
