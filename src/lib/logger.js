const pino = require('pino');
const { config } = require('../config');

// Structured JSON logging per spec — no pretty-printer dependency, keeps
// output machine-parseable and avoids worker-thread transports on Windows.
const logger = pino({ level: config.LOG_LEVEL });

module.exports = { logger };
