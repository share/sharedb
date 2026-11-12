var expect = require('chai').expect;
var json0 = require('ot-json0').type;
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
      test(
        {0: true},
        {op: [{p: [0], na: 1}]}
      );
    });

    [
      null,
      {},
      [null],
      [{}],
      [{p: null}],
      [{p: 'x'}],
      [{p: [{toString: 'x'}]}]
    ].forEach(function(edit) {
      it('does not allow the malformed op ' + JSON.stringify(edit), function() {
        expect(projections.isOpAllowed(null, {x: true}, {op: edit})).equal(false);
      });
    });
  });

  describe('non-truthy field values', function() {
    it('does not treat a false field as a projected field', function() {
      var op = {op: [{p: ['x', 'y'], oi: 'nope'}]};
      expect(projections.isOpAllowed(null, {x: false}, op)).equal(false);
      projections.projectOp({x: false}, op);
      expect(op).eql({op: []});
    });

    it('does not treat a false field as an allowed snapshot field', function() {
      expect(projections.isSnapshotAllowed({x: false}, {type: type, data: {x: 1}})).equal(false);
    });
  });

  describe('field names inherited from Object.prototype', function() {
    ['__proto__', 'constructor', 'toString'].forEach(function(badProp) {
      it('does not treat ' + badProp + ' as a projected field', function() {
        var op = {op: [{p: [badProp, 'x'], oi: 'oops'}]};
        expect(projections.isOpAllowed(null, {x: true}, op)).equal(false);
        projections.projectOp({x: true}, op);
        expect(op).eql({op: []});
      });

      it('does not treat ' + badProp + ' as an allowed snapshot field', function() {
        var data = JSON.parse('{"' + badProp + '": "oops"}');
        expect(projections.isSnapshotAllowed({x: true}, {type: type, data: data})).equal(false);
      });
    });
  });
});

describe('sub-field projections', function() {
  describe('projectSnapshot', function() {
    function test(fields, data, expected) {
      var snapshot = {type: type, data: data};
      projections.projectSnapshot(fields, snapshot);
      expect(snapshot.data).eql(expected);
    }

    it('keeps only the listed sub-fields', function() {
      test(
        {'owner.name': true},
        {age: 3, owner: {name: 'jim', phone: '555'}},
        {owner: {name: 'jim'}}
      );
    });

    it('mixes top-level fields and sub-fields', function() {
      test(
        {age: true, 'owner.name': true, 'owner.address.city': true},
        {age: 3, owner: {name: 'jim', phone: '555', address: {city: 'Durham', zip: '27708'}}},
        {age: 3, owner: {name: 'jim', address: {city: 'Durham'}}}
      );
    });

    it('keeps whole values at and below a projected sub-field', function() {
      test(
        {'owner.address': true},
        {owner: {name: 'jim', address: {city: 'Durham', lines: ['a', 'b']}}},
        {owner: {address: {city: 'Durham', lines: ['a', 'b']}}}
      );
    });

    it('lets a projected ancestor include its whole subtree, in either order', function() {
      var data = {owner: {name: 'jim', phone: '555'}};
      test({owner: true, 'owner.name': true}, clone(data), data);
      test({'owner.name': true, owner: true}, clone(data), data);
    });

    it('returns an empty object for a parent with none of the sub-fields', function() {
      test({'owner.name': true}, {owner: {phone: '555'}}, {owner: {}});
    });

    it('leaves out a parent that is missing', function() {
      test({'owner.name': true}, {age: 3}, {});
    });

    it('leaves out a parent that is not an object', function() {
      test({'owner.name': true}, {owner: 'jim'}, {});
      test({'owner.name': true}, {owner: 5}, {});
      test({'owner.name': true}, {owner: null}, {});
      test({'owner.name': true}, {owner: [{name: 'jim'}]}, {});
    });

    it('ignores falsy sub-fields', function() {
      test({'owner.name': false, age: true}, {age: 3, owner: {name: 'jim'}}, {age: 3});
    });

    it('does not read sub-fields from the prototype', function() {
      test({'owner.toString': true}, {owner: {name: 'jim'}}, {owner: {}});
      test({'owner.__proto__': true}, {owner: {name: 'jim'}}, {owner: {}});
    });

    it('does not treat numeric sub-fields as array indexes', function() {
      test({'owner.0': true}, {owner: ['jim']}, {});
      test({'owner.0': true}, {owner: {0: 'jim'}}, {owner: {0: 'jim'}});
    });

    it('treats dotted fields as paths, not literal keys', function() {
      test({'owner.name': true}, {'owner.name': 'jim'}, {});
    });
  });

  describe('projectOp', function() {
    var fields = {age: true, 'owner.name': true, 'owner.address.city': true};

    function test(c, expected) {
      var op = {op: [c]};
      projections.projectOp(fields, op);
      expect(op.op).eql(expected);
    }

    it('keeps edits to a projected sub-field', function() {
      test({p: ['owner', 'name'], od: 'jim', oi: 'bob'}, [{p: ['owner', 'name'], od: 'jim', oi: 'bob'}]);
      test({p: ['owner', 'address', 'city'], oi: 'Durham'}, [{p: ['owner', 'address', 'city'], oi: 'Durham'}]);
    });

    it('keeps edits below a projected sub-field', function() {
      test({p: ['owner', 'name', 2], si: 'x'}, [{p: ['owner', 'name', 2], si: 'x'}]);
      test({p: ['owner', 'name', 0], sd: 'j'}, [{p: ['owner', 'name', 0], sd: 'j'}]);
      test({p: ['owner', 'name', 'first'], oi: 'J'}, [{p: ['owner', 'name', 'first'], oi: 'J'}]);
      test({p: ['owner', 'name', 0], li: 'J'}, [{p: ['owner', 'name', 0], li: 'J'}]);
      test({p: ['owner', 'name', 0], lm: 1}, [{p: ['owner', 'name', 0], lm: 1}]);
      test({p: ['owner', 'name', 'n'], na: 1}, [{p: ['owner', 'name', 'n'], na: 1}]);
      test({p: ['owner', 'name'], t: 'text0', o: [{p: 0, i: 'x'}]},
        [{p: ['owner', 'name'], t: 'text0', o: [{p: 0, i: 'x'}]}]);
    });

    it('drops edits to sibling sub-fields that are not projected', function() {
      test({p: ['owner', 'phone'], oi: '555'}, []);
      test({p: ['owner', 'phone', 0], si: '1'}, []);
      test({p: ['owner', 'address', 'zip'], oi: '27708'}, []);
      test({p: ['owner', 'tags', 0], li: 'x'}, []);
      test({p: ['owner', 'count'], na: 1}, []);
    });

    it('drops edits that go through an array on the way to a sub-field', function() {
      test({p: ['owner', 0], li: {name: 'jim'}}, []);
      test({p: ['owner', 0, 'name'], oi: 'jim'}, []);
    });

    it('projects the values when replacing a parent of projected sub-fields', function() {
      test(
        {p: ['owner'], od: {name: 'jim', phone: '555'}, oi: {name: 'bob', phone: '556', address: {city: 'Austin'}}},
        [{p: ['owner'], od: {name: 'jim'}, oi: {name: 'bob', address: {city: 'Austin'}}}]
      );
      test(
        {p: ['owner', 'address'], oi: {city: 'Durham', zip: '27708'}},
        [{p: ['owner', 'address'], oi: {city: 'Durham'}}]
      );
    });

    it('drops the non-object side when replacing a parent of projected sub-fields', function() {
      test({p: ['owner'], od: 'jim', oi: {name: 'jim'}}, [{p: ['owner'], oi: {name: 'jim'}}]);
      test({p: ['owner'], od: {name: 'jim'}, oi: ['jim']}, [{p: ['owner'], od: {name: 'jim'}}]);
      test({p: ['owner'], od: 'jim', oi: 5}, []);
    });

    it('drops non-object edits to a parent of projected sub-fields', function() {
      test({p: ['owner'], na: 1}, []);
      test({p: ['owner', 0], si: 'x'}, []);
      test({p: ['owner'], t: 'text0', o: [{p: 0, i: 'x'}]}, []);
    });

    it('projects root replacements recursively', function() {
      test(
        {p: [], oi: {age: 2, color: 'tan', owner: {name: 'bob', phone: '1'}}},
        [{p: [], oi: {age: 2, owner: {name: 'bob'}}}]
      );
    });
  });

  describe('isOpAllowed', function() {
    var fields = {age: true, 'owner.name': true, 'owner.address.city': true};

    function allowed(c) {
      return projections.isOpAllowed(type, fields, {op: [c]});
    }

    it('allows edits at or below a projected sub-field', function() {
      expect(allowed({p: ['owner', 'name'], od: 'jim', oi: 'bob'})).equal(true);
      expect(allowed({p: ['owner', 'name', 0], si: 'x'})).equal(true);
      expect(allowed({p: ['owner', 'address', 'city'], oi: 'Durham'})).equal(true);
      expect(allowed({p: ['age'], na: 1})).equal(true);
    });

    it('rejects edits to sub-fields that are not projected', function() {
      expect(allowed({p: ['owner', 'phone'], oi: '555'})).equal(false);
      expect(allowed({p: ['owner', 'phone', 0], si: '5'})).equal(false);
      expect(allowed({p: ['owner', 'address', 'zip'], oi: '27708'})).equal(false);
    });

    it('rejects replacing a parent of projected sub-fields', function() {
      // The real parent may hold fields the client can't see
      expect(allowed({p: ['owner'], oi: {name: 'bob'}})).equal(false);
      expect(allowed({p: ['owner'], od: {name: 'jim'}})).equal(false);
      expect(allowed({p: ['owner', 'address'], oi: {city: 'Durham'}})).equal(false);
    });

    it('rejects array indexes on the way to a sub-field', function() {
      expect(allowed({p: ['owner', 0], li: 'x'})).equal(false);
      expect(allowed({p: ['owner', 0, 'name'], oi: 'x'})).equal(false);
    });

    it('allows creates with only projected sub-fields', function() {
      var create = {type: type, data: {age: 1, owner: {name: 'jim', address: {city: 'Durham'}}}};
      expect(projections.isOpAllowed(null, fields, {create: create})).equal(true);
      expect(projections.isOpAllowed(null, fields, {create: {type: type, data: {owner: {}}}})).equal(true);
    });

    it('rejects creates with sub-fields that are not projected', function() {
      var create = {type: type, data: {owner: {name: 'jim', phone: '555'}}};
      expect(projections.isOpAllowed(null, fields, {create: create})).equal(false);
    });

    it('rejects creates with a non-object parent of projected sub-fields', function() {
      expect(projections.isOpAllowed(null, fields, {create: {type: type, data: {owner: 'jim'}}})).equal(false);
      expect(projections.isOpAllowed(null, fields, {create: {type: type, data: {owner: ['jim']}}})).equal(false);
    });

    it('does not allow anything that projectOp would change', function() {
      var cs = [
        {p: ['owner', 'name'], oi: 'bob'},
        {p: ['owner', 'phone'], oi: '555'},
        {p: ['owner'], oi: {name: 'bob'}},
        {p: ['owner', 0], li: 'x'},
        {p: ['owner', 'address', 'city', 1], si: 'x'}
      ];
      cs.forEach(function(c) {
        var op = {op: [clone(c)]};
        var isAllowed = projections.isOpAllowed(type, fields, op);
        projections.projectOp(fields, op);
        if (isAllowed) expect(op.op).eql([c]);
      });
    });
  });

  describe('hasSubFields', function() {
    it('detects dotted fields', function() {
      expect(projections.hasSubFields({a: true, b: true})).equal(false);
      expect(projections.hasSubFields({a: true, 'b.c': true})).equal(true);
      expect(projections.hasSubFields({})).equal(false);
    });
  });

  // For any op, applying the projected op to the projected snapshot must give
  // the same result as projecting the snapshot after applying the real op.
  // Otherwise clients reading through a projection drift out of sync.
  describe('projected ops keep projected snapshots in sync (randomized)', function() {
    var KEYS = ['a', 'b', 'c', 'd'];
    var FIELD_SETS = [
      {a: true},
      {'a.b': true},
      {'a.b.c': true, d: true},
      {a: true, 'a.b': true},
      {'a.b': true, 'a.c.d': true, b: true},
      {'b.a.a': true, 'c.c': true},
      // Numeric segments must not reach into arrays
      {'a.0': true, 'b.1.c': true}
    ];

    // Small deterministic PRNG so failures are reproducible
    function rng(seed) {
      return function() {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        return seed / 0x7fffffff;
      };
    }

    function pick(random, list) {
      return list[Math.floor(random() * list.length)];
    }

    function randomValue(random, depth) {
      var r = random();
      if (depth <= 0 || r < 0.25) return Math.floor(random() * 10);
      if (r < 0.4) return pick(random, ['x', 'yz', 'abc']);
      if (r < 0.55) {
        var list = [];
        var n = Math.floor(random() * 3);
        for (var i = 0; i < n; i++) list.push(randomValue(random, depth - 1));
        return list;
      }
      var obj = {};
      KEYS.forEach(function(key) {
        if (random() < 0.6) obj[key] = randomValue(random, depth - 1);
      });
      return obj;
    }

    function randomObject(random, depth) {
      var value = randomValue(random, depth);
      return (value && typeof value === 'object' && !Array.isArray(value)) ? value : {};
    }

    function collectPaths(value, path, out) {
      out.push({path: path, value: value});
      if (Array.isArray(value)) {
        for (var i = 0; i < value.length; i++) collectPaths(value[i], path.concat(i), out);
      } else if (value && typeof value === 'object') {
        for (var key in value) collectPaths(value[key], path.concat(key), out);
      }
      return out;
    }

    function randomComponent(random, data) {
      var nodes = collectPaths(data, [], []);
      var node = pick(random, nodes);
      var path = node.path;
      var value = node.value;
      var parentKey = path[path.length - 1];
      var r = random();

      if (path.length === 0) {
        if (r < 0.2) return {p: [], od: clone(data), oi: randomObject(random, 3)};
        var key = pick(random, KEYS);
        if (data[key] === undefined) return {p: [key], oi: randomValue(random, 3)};
        return {p: [key], od: clone(data[key]), oi: randomValue(random, 3)};
      }
      if (typeof value === 'number' && r < 0.5) return {p: path, na: 1};
      if (typeof value === 'string' && r < 0.5) {
        var offset = Math.floor(random() * (value.length + 1));
        if (random() < 0.5 || offset === value.length) return {p: path.concat(offset), si: 'q'};
        return {p: path.concat(offset), sd: value.charAt(offset)};
      }
      if (Array.isArray(value) && r < 0.5) {
        return {p: path.concat(Math.floor(random() * (value.length + 1))), li: randomValue(random, 2)};
      }
      if (value && typeof value === 'object' && !Array.isArray(value) && r < 0.5) {
        var newKey = pick(random, KEYS);
        if (value[newKey] === undefined) return {p: path.concat(newKey), oi: randomValue(random, 2)};
      }
      if (typeof parentKey === 'number') {
        var parent = nodes.filter(function(n) {
          return n.path.length === path.length - 1 && n.path.every(function(k, i) {
            return k === path[i];
          });
        })[0].value;
        var r2 = random();
        if (r2 < 0.33) return {p: path, ld: clone(value)};
        if (r2 < 0.66) return {p: path, lm: Math.floor(random() * parent.length)};
        return {p: path, ld: clone(value), li: randomValue(random, 2)};
      }
      if (random() < 0.3) return {p: path, od: clone(value)};
      return {p: path, od: clone(value), oi: randomValue(random, 3)};
    }

    function project(fields, data) {
      var snapshot = {type: type, data: clone(data)};
      projections.projectSnapshot(fields, snapshot);
      return snapshot.data;
    }

    FIELD_SETS.forEach(function(fields) {
      it('for fields ' + JSON.stringify(Object.keys(fields)), function() {
        var random = rng(42 + Object.keys(fields).join().length);
        for (var run = 0; run < 40; run++) {
          var data = randomObject(random, 4);
          var projected = project(fields, data);
          for (var step = 0; step < 25; step++) {
            var c = randomComponent(random, data);
            var op = {op: [clone(c)]};
            projections.projectOp(fields, op);

            data = json0.apply(data, [clone(c)]);
            projected = json0.apply(projected, clone(op.op));
            var context = JSON.stringify({component: c, projectedOp: op.op});
            expect(projected, context).eql(project(fields, data));

            if (projections.isOpAllowed(type, fields, {op: [clone(c)]})) {
              expect(op.op, context).eql([c]);
            }
          }
        }
      });
    });
  });
});
