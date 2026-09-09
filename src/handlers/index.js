const { toStaging } = require('./toStaging');
const { toDevelop } = require('./toDevelop');
const { rejected } = require('./rejected');
const { STATUS_HANDLER_MAP } = require('../lib/constants');

const HANDLERS = { toStaging, toDevelop, rejected };

function dispatch(status) {
  const name = STATUS_HANDLER_MAP[status];
  return name ? HANDLERS[name] : null;
}

module.exports = { dispatch, HANDLERS };
