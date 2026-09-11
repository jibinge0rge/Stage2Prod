const { toStaging } = require('./toStaging');
const { toDevelop } = require('./toDevelop');
const { handlerForStatus } = require('../lib/statusHandlerMap');

const HANDLERS = { toStaging, toDevelop };

/**
 * Look up the handler for a Jira status name.
 * `map` is an optional per-repo stage→Jira map (falls back to defaults).
 * Only In QA / Ready for release stages open PRs; rejected is not used.
 */
function dispatch(status, map) {
  const name = handlerForStatus(status, map);
  return name ? HANDLERS[name] : null;
}

module.exports = { dispatch, HANDLERS };
