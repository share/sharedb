exports.type = {
  name: 'presence-test-type',
  uri: 'http://sharejs.org/types/presence-test-type',
  create: create,
  apply: apply,
  transformPresence: transformPresence
};

function create(data) {
  return typeof data === 'string' ? data : '';
}

function apply(snapshot, op) {
  if (op.value) {
    return snapshot.substring(0, op.index) + op.value + snapshot.substring(op.index);
  } else if (op.del) {
    return snapshot.substring(0, op.index) + snapshot.substring(op.index + op.del);
  }

  throw new Error('Invalid op');
}

function transformPresence(presence, op, isOwnOperation) {
  if (!presence || presence.index < op.index || (presence.index === op.index && !isOwnOperation)) {
    return presence;
  }

  if (typeof presence.index !== 'number') throw new Error('Presence index is not a number');

  if (op.value) {
    return {index: presence.index + op.value.length};
  } else if (op.del) {
    return {index: presence.index - op.del};
  }

  throw new Error('Invalid op');
}
