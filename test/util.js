
exports.sortById = function(docs) {
  return docs.slice().sort(function(a, b) {
    if (a.id > b.id) return 1;
    if (b.id > a.id) return -1;
    return 0;
  });
};

exports.pluck = function(docs, key) {
  var values = [];
  for (var i = 0; i < docs.length; i++) {
    values.push(docs[i][key]);
  }
  return values;
};
