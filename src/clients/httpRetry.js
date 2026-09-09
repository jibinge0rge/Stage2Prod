const { logger } = require('../lib/logger');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Shared exponential-backoff-with-jitter retry loop. A 409 is never
 * retried — conflicts are a terminal business outcome, not a transient
 * failure, regardless of the caller's isRetryable predicate.
 */
async function withRetry(fn, opts = {}) {
  const {
    retries = 3,
    isRetryable = (err) => err.status >= 500 && err.status < 600,
    baseDelayMs = 300,
    retryAfterMs = () => null,
    onRetry = () => {},
  } = opts;

  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return await fn();
    } catch (err) {
      if (err.status === 409 || !isRetryable(err) || attempt >= retries) throw err;
      const explicit = retryAfterMs(err);
      const delay = explicit ?? baseDelayMs * 2 ** attempt + Math.floor(Math.random() * 100);
      onRetry({ attempt, delay, err });
      logger.warn({ attempt, delay, status: err.status, message: err.message }, 'retrying after transient failure');
      await sleep(delay);
      attempt += 1;
    }
  }
}

module.exports = { withRetry, sleep };
