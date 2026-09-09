const { config, assertRuntimeConfig } = require('./config');
const { buildContext } = require('./context');
const { createApp } = require('./app');
const { logger } = require('./lib/logger');

assertRuntimeConfig();

const ctx = buildContext(config);
const app = createApp(ctx);

const server = app.listen(config.PORT, () => {
  logger.info({ port: config.PORT, dryRun: config.DRY_RUN }, 'Stage2Prod listening');
  ctx.poller.start();
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'shutdown initiated');
  server.close(() => logger.info('http server closed'));
  await ctx.poller.stop();
  ctx.db.close();
  logger.info('shutdown complete');
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
