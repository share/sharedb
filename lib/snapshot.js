module.exports = Snapshot;
function Snapshot(collection, id, version, type, data, meta) {
  if (collection) this.collection = collection;
  this.id = id;
  this.v = version;
  this.type = type;
  this.data = data;
  if (meta) this.m = meta;
}
