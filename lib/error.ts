
class ShareDBError extends Error {

  constructor(public code, message) {
    super(message);
  }
}



module.exports = ShareDBError;
