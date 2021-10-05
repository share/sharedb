var expect = require('chai').expect;
var projections = require('../lib/projections');
var type = require('../lib/types').defaultType.uri;
var clone = require('../lib/util').clone;

describe('projection utility methods', function() {
  describe('projectSnapshot', function() {
    function test(fields, snapshot, expected) {
      projections.projectSnapshot(fields, snapshot);
      expect(snapshot).eql(expected);
    }

    it('throws on snapshots with the wrong type', function() {
      expect(function() {
        projections.projectSnapshot({}, {type: 'other', data: 123});
      }).throw(Error);
    });

    it('empty object filters out all properties', function() {
      test(
        {},
        {type: type, data: undefined},
        {type: type, data: undefined}
      );
      test(
        {},
        {type: type, data: null},
        {type: type, data: null}
      );
      test(
        {},
        {type: type, data: {}},
        {type: type, data: {}}
      );
      test(
        {},
        {type: type, data: {a: 2}},
        {type: type, data: {}}
      );
    });

    it('works the same way on null or undefined type', function() {
      test(
        {},
        {type: null, data: undefined},
        {type: null, data: undefined}
      );
      test(
        {},
        {type: null, data: null},
        {type: null, data: null}
      );
      test(
        {},
        {type: null, data: {}},
        {type: null, data: {}}
      );
      test(
        {},
        {type: null, data: {a: 2}},
        {type: null, data: {}}
      );

      test(
        {},
        {data: undefined},
        {data: undefined}
      );
      test(
        {},
        {data: null},
        {data: null}
      );
      test(
        {},
        {data: {}},
        {data: {}}
      );
      test(
        {},
        {data: {a: 2}},
        {data: {}}
      );
    });

    it('filters out any non-truthy properties', function() {
      test(
        {x: true},
        {type: type, data: {x: 2}},
        {type: type, data: {x: 2}}
      );
      test(
        {x: true},
        {type: type, data: {x: [1, 2, 3]}},
        {type: type, data: {x: [1, 2, 3]}}
      );
      test(
        {x: true},
        {type: type, data: {a: 2, x: 5}},
        {type: type, data: {x: 5}}
      );
    });

    it('returns null for non-object snapshot data', function() {
      test(
        {x: true},
        {type: type, data: undefined},
        {type: type, data: undefined}
      );
      test(
        {x: true},
        {type: type, data: null},
        {type: type, data: null}
      );
      test(
        {x: true},
        {type: type, data: []},
        {type: type, data: null}
      );
      test(
        {x: true},
        {type: type, data: 4},
        {type: type, data: null}
      );
      test(
        {x: true},
        {type: type, data: 'hi'},
        {type: type, data: null}
      );
    });
  });

  describe('projectOp', function() {
    function test(fields, op, expected) {
      projections.projectOp(fields, op);
      expect(op).eql(expected);
    }

    it('passes src/seq into the projected op', function() {
      test(
        {},
        {src: 'src', seq: 123, op: []},
        {src: 'src', seq: 123, op: []}
      );
    });

    describe('op', function() {
      it('filters components on the same level', function() {
        test(
          {},
          {op: []},
          {op: []}
        );
        test(
          {},
          {op: [{p: ['x'], na: 1}]},
          {op: []}
        );
        test(
          {x: true},
          {op: [{p: ['x'], na: 1}]},
          {op: [{p: ['x'], na: 1}]}
        );
        test(
          {y: true},
          {op: [{p: ['x'], na: 1}]},
          {op: []}
        );
        test(
          {x: true, y: true},
          {op: [{p: ['x'], od: 2, oi: 3}, {p: ['y'], na: 1}]},
          {op: [{p: ['x'], od: 2, oi: 3}, {p: ['y'], na: 1}]}
        );
        test(
          {y: true},
          {op: [{p: ['x'], od: 2, oi: 3}, {p: ['y'], na: 1}]},
          {op: [{p: ['y'], na: 1}]}
        );
        test(
          {x: true},
          {op: [{p: ['x'], od: 2, oi: 3}, {p: ['y'], na: 1}]},
          {op: [{p: ['x'], od: 2, oi: 3}]}
        );
      });

      it('filters root ops', function() {
        test(
          {},
          {op: [{p: [], od: {a: 1, x: 2}, oi: {x: 3}}]},
          {op: [{p: [], od: {}, oi: {}}]}
        );
        test(
          {x: true},
          {op: [{p: [], od: {a: 1, x: 2}, oi: {x: 3}}]},
          {op: [{p: [], od: {x: 2}, oi: {x: 3}}]}
        );
        test(
          {x: true},
          {op: [{p: [], od: {a: 1, x: 2}, oi: {z: 3}}]},
          {op: [{p: [], od: {x: 2}, oi: {}}]}
        );
        test(
          {x: true, a: true, z: true},
          {op: [{p: [], od: {a: 1, x: 2}, oi: {z: 3}}]},
          {op: [{p: [], od: {a: 1, x: 2}, oi: {z: 3}}]}
        );
        test(
          {x: true},
          {op: [{p: [], na: 5}]},
          {op: []}
        );
        // If you make the document something other than an object, it just looks like null.
        test(
          {x: true},
          {op: [{p: [], od: {a: 2, x: 5}, oi: []}]},
          {op: [{p: [], od: {x: 5}, oi: null}]}
        );
      });

      it('allows editing in-property fields', function() {
        test(
          {},
          {op: [{p: ['x', 'y'], na: 1}]},
          {op: []}
        );
        test(
          {x: true},
          {op: [{p: ['x', 'y'], na: 1}]},
          {op: [{p: ['x', 'y'], na: 1}]}
        );
        test(
          {x: true},
          {op: [{p: ['x'], na: 1}]},
          {op: [{p: ['x'], na: 1}]}
        );
        test(
          {y: true},
          {op: [{p: ['x', 'y'], na: 1}]},
          {op: []}
        );
      });
    });

    describe('create', function() {
      it('throws on create ops with the wrong type', function() {
        expect(function() {
          projections.projectOp({}, {create: {type: 'other', data: 123}});
        }).throw(Error);
      });

      it('strips data in creates', function() {
        test(
          {x: true},
          {create: {type: type, data: {x: 10}}},
          {create: {type: type, data: {x: 10}}}
        );
        test(
          {x: true},
          {create: {type: type, data: {y: 10}}},
          {create: {type: type, data: {}}}
        );
      });
    });
  });

  describe('isSnapshotAllowed', function() {
    function test(fields, snapshot) {
      var previous = clone(snapshot);
      var isAllowed = projections.isSnapshotAllowed(fields, snapshot);
      projections.projectSnapshot(fields, snapshot);
      if (isAllowed) {
        expect(snapshot).eql(previous);
      } else {
        expect(snapshot).not.eql(previous);
      }
    }

    it('returns true iff projectSnapshot returns the original object', function() {
      test(
        {x: true},
        {type: type, data: {x: 5}}
      );
      test(
        {},
        {type: type, data: {x: 5}}
      );
      test(
        {x: true},
        {type: type, data: {x: {y: true}}}
      );
      test(
        {y: true},
        {type: type, data: {x: {y: true}}}
      );
      test(
        {x: true},
        {type: type, data: {x: 4, y: 6}}
      );
    });

    it('returns true for undefined or null data', function() {
      expect(projections.isSnapshotAllowed({}, {type: type, data: undefined})).equal(true);
      expect(projections.isSnapshotAllowed({}, {type: type, data: null})).equal(true);
    });

    it('returns false for any non-object thing', function() {
      expect(projections.isSnapshotAllowed({}, {type: type, data: 3})).equal(false);
      expect(projections.isSnapshotAllowed({}, {type: type, data: []})).equal(false);
      expect(projections.isSnapshotAllowed({}, {type: type, data: 'hi'})).equal(false);
    });
  });

  describe('isOpAllowed', function() {
    function test(fields, op) {
      var previous = clone(op);
      var isAllowed = projections.isOpAllowed(null, fields, op);
      var err;
      try {
        projections.projectOp(fields, op);
      } catch (e) {
        err = e;
      }
      if (isAllowed) {
        expect(op).eql(previous);
      } else {
        // If not allowed, should throw an error, not be equivalent, or set
        // the parent path
        if (err) return;
        expect(op).not.eql(previous);
      }
    }

    it('works with create ops', function() {
      test(
        {},
        {create: {type: type, data: null}}
      );
      test(
        {x: true},
        {create: {type: 'something else'}}
      );

      test(
        {x: true},
        {create: {type: type, data: {}}}
      );
      test(
        {x: true},
        {create: {type: type, data: {x: 5}}}
      );
      test(
        {x: true},
        {create: {type: type, data: {y: 5}}}
      );
    });

    it('works with del ops', function() {
      test(
        {},
        {del: true}
      );
      expect(projections.isOpAllowed(null, {}, {del: true})).equal(true);
    });

    it('works with ops', function() {
      test(
        {x: true},
        {op: [{p: ['x'], na: 1}]}
      );
      test(
        {y: true},
        {op: [{p: ['x'], na: 1}]}
      );
      test(
        {},
        {op: [{p: ['x'], na: 1}]}
      );
      test(
        {x: true},
        {op: [{p: ['x'], na: 1}, {p: ['y'], na: 1}]}
      );
      test(
        {x: true},
        {op: [{p: [], oi: {y: 1}}]}
      );
    });
  });
});
