module.exports = {
  major: 1,
  minor: 2,
  checkAtLeast: checkAtLeast
};

function checkAtLeast(toCheck, checkAgainst) {
  toCheck = normalizedProtocol(toCheck);
  checkAgainst = normalizedProtocol(checkAgainst);
  if (toCheck.major > checkAgainst.major) return true;
  return toCheck.major === checkAgainst.major &&
    toCheck.minor >= checkAgainst.minor;
}

function normalizedProtocol(protocol) {
  if (typeof protocol === 'string') {
    var segments = protocol.split('.');
    protocol = {
      major: segments[0],
      minor: segments[1]
    };
  }

  return {
    major: +(protocol.protocol || protocol.major || 0),
    minor: +(protocol.protocolMinor || protocol.minor || 0)
  };
}
