// Express 4 doesn't catch rejected promises thrown by async route handlers
// on its own (that's an Express 5 feature) — without this, an unexpected
// error in an async handler would just hang the request forever instead of
// responding with a 500.
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = asyncHandler;
