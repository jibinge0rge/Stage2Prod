const { logger } = require('./logger');

/**
 * Wraps the named mutating methods of a client so that, when dryRun is
 * true, calls are logged and a synthetic result is returned instead of
 * hitting the real API. Handlers never branch on config.DRY_RUN
 * themselves — the client looks identical either way.
 *
 * `syntheticResults` maps method name -> (args) => result, so each
 * wrapped call can return a shape matching its real counterpart.
 */
function wrapWithDryRun(client, methodNames, syntheticResults, dryRun) {
  if (!dryRun) return client;
  const wrapped = Object.create(client);
  for (const method of methodNames) {
    const original = client[method];
    if (typeof original !== 'function') continue;
    wrapped[method] = async (...args) => {
      logger.info({ method, args }, '[DRY_RUN] would call, skipping real request');
      const build = syntheticResults[method];
      const result = build ? build(...args) : { dryRun: true };
      return { ...result, dryRun: true };
    };
  }
  return wrapped;
}

module.exports = { wrapWithDryRun };
