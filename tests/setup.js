const { createDb } = require('../src/db');
const { createTicketsRepo } = require('../src/db/repositories/ticketsRepo');
const { createEventsRepo } = require('../src/db/repositories/eventsRepo');
const { createCursorRepo } = require('../src/db/repositories/cursorRepo');
const { createLockEventsRepo } = require('../src/db/repositories/lockEventsRepo');
const { createReposRepo } = require('../src/db/repositories/reposRepo');
const { RefLockManager } = require('../src/lib/mutex');

function createTestDb() {
  const db = createDb(':memory:');
  const ticketsRepo = createTicketsRepo(db);
  const eventsRepo = createEventsRepo(db);
  const cursorRepo = createCursorRepo(db);
  const lockEventsRepo = createLockEventsRepo(db);
  const reposRepo = createReposRepo(db);
  const lockManager = new RefLockManager();
  lockManager.attachRepo(lockEventsRepo);
  return { db, ticketsRepo, eventsRepo, cursorRepo, lockEventsRepo, reposRepo, lockManager };
}

function seedTicket(ticketsRepo, overrides = {}) {
  ticketsRepo.upsert({
    key: 'PROJ-100',
    summary: 'Test ticket',
    jiraStatus: 'In QA',
    lastSeenStatus: 'In Development',
    pipelineState: 'unmerged',
    ...overrides,
  });
}

const noopLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => noopLogger,
};

/** A repo-shaped ticketMatcher/github stub factory, for handler/route tests. */
function fakeRepoResolver({ getClient, getMatcher } = {}) {
  return {
    resolveTicket: async () => ({ found: true, owner: 'acme', name: 'widgets' }),
    invalidateAll: () => {},
    getClient: getClient || (() => ({})),
    getMatcher: getMatcher || (() => ({})),
  };
}

/** Stub for ctx.displayGithub, used by the branches/untracked GET routes. */
function fakeDisplayGithub({ getClient } = {}) {
  return { getClient: getClient || (() => ({})) };
}

module.exports = { createTestDb, seedTicket, noopLogger, fakeRepoResolver, fakeDisplayGithub };
