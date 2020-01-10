var richText = require('rich-text');

richText.type.transformPresence = function(presence, op, isOwnOp) {
  if (!presence) {
    return null;
  }

  var start = presence.index;
  var end = presence.index + presence.length;
  var delta = new richText.Delta(op);
  start = delta.transformPosition(start, !isOwnOp);
  end = delta.transformPosition(end, !isOwnOp);

  return Object.assign({}, presence, {
    index: start,
    length: end - start
  });
};

module.exports = richText;
