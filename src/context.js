const { createDb } = require('./db');
const { createTicketsRepo } = require('./db/repositories/ticketsRepo');
const { createEventsRepo } = require('./db/repositories/eventsRepo');
const { createCursorRepo } = require('./db/repositories/cursorRepo');
const { createLockEventsRepo } = require('./db/repositories/lockEventsRepo');
const { createReposRepo } = require('./db/repositories/reposRepo');
const { createCutsRepo } = require('./db/repositories/cutsRepo');
const { createGithubClientRegistry } = require('./clients/githubRegistry');
const { createDisplayGithubClients } = require('./clients/displayReadCache');
const { createJiraClient } = require('./clients/jira');
const { createRepoResolver } = require('./services/repoResolver');
const { RefLockManager } = require('./lib/mutex');
const { logger } = require('./lib/logger');
const { Poller } = require('./poller');

/**
 * Builds the full set of wired dependencies the app/routes/poller need.
 * Accepts overrides so tests can substitute an in-memory DB and/or mocked
 * clients while reusing all the real wiring logic.
 */
async function buildContext(config, overrides = {}) {
  const db = overrides.db || (await createDb(config.DATABASE_URL));
  const ticketsRepo = overrides.ticketsRepo || createTicketsRepo(db);
  const eventsRepo = overrides.eventsRepo || createEventsRepo(db);
  const cursorRepo = overrides.cursorRepo || createCursorRepo(db);
  const lockEventsRepo = overrides.lockEventsRepo || createLockEventsRepo(db);
  const reposRepo = overrides.reposRepo || createReposRepo(db);
  const cutsRepo = overrides.cutsRepo || createCutsRepo(db);

  const lockManager = overrides.lockManager || new RefLockManager();
  lockManager.attachRepo(lockEventsRepo);

  const githubRegistry = overrides.githubRegistry || createGithubClientRegistry(config);
  const jira = overrides.jira || createJiraClient(config);
  const repoResolver = overrides.repoResolver || createRepoResolver({ reposRepo, githubRegistry });
  const displayGithub = overrides.displayGithub || createDisplayGithubClients(repoResolver);

  const poller = overrides.poller || new Poller({
    jira, repoResolver, reposRepo, config, ticketsRepo, eventsRepo, cursorRepo, lockManager, logger,
  });

  return {
    db,
    config,
    ticketsRepo,
    eventsRepo,
    cursorRepo,
    lockEventsRepo,
    reposRepo,
    cutsRepo,
    lockManager,
    githubRegistry,
    jira,
    repoResolver,
    displayGithub,
    poller,
    logger,
  };
}

module.exports = { buildContext };
