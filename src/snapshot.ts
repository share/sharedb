export = Snapshot;

class Snapshot {
  id;
  v;
  type;
  data;
  m;

  constructor(id, version, type, data, meta) {
    this.id = id;
    this.v = version;
    this.type = type;
    this.data = data;
    this.m = meta;
  }
}
