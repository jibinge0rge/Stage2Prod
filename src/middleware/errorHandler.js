const { logger } = require('../lib/logger');
const { LockHeldError } = require('../lib/mutex');

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err instanceof LockHeldError) {
    return res.status(409).json({
      error: 'staging_locked',
      message: err.message,
      holder: err.holder,
      heldMs: err.heldMs,
    });
  }
  logger.error({ err: err.message, stack: err.stack, path: req.path }, 'unhandled route error');
  const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 500;
  return res.status(status).json({
    error: err.code || (status === 500 ? 'internal_error' : 'request_failed'),
    message: err.message,
  });
}

module.exports = { errorHandler };
