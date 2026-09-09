const { nanoid } = require('nanoid');

function newCorrelationId() {
  return nanoid(12);
}

module.exports = { newCorrelationId };
