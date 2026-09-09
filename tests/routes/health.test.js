const request = require('supertest');
const { createApp } = require('../../src/app');
const { createTestDb } = require('../setup');
const { config } = require('../../src/config');

function buildTestCtx(overrides = {}) {
  const { ticketsRepo, eventsRepo, cursorRepo, lockManager, reposRepo } = createTestDb();
  const githubRegistry = { rateLimit: { remaining: 4999, limit: 5000, resetAt: null } };
  const jira = {};
  const poller = { isRunning: () => true, nextPollAt: '2026-04-20T15:00:00.000Z' };
  return { config, ticketsRepo, eventsRepo, cursorRepo, lockManager, reposRepo, githubRegistry, jira, poller, ...overrides };
}

describe('GET /api/health', () => {
  it('reports poller, github rate limit, and lock snapshot', async () => {
    const ctx = buildTestCtx();
    ctx.reposRepo.add('acme', 'widgets', { productionBranch: 'main', stagingBranch: 'qa' });
    const app = createApp(ctx);

    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body.poller.running).toBe(true);
    expect(res.body.github.rateLimitRemaining).toBe(4999);
    expect(res.body.watchedRepos).toEqual([
      { owner: 'acme', name: 'widgets', productionBranch: 'main', stagingBranch: 'qa' },
    ]);
    expect(Array.isArray(res.body.locks)).toBe(true);
    expect(res.body.locks.some((l) => l.ref === 'acme/widgets#refs/heads/qa')).toBe(true);
    expect(res.body.locks.some((l) => l.ref === 'acme/widgets#refs/heads/main')).toBe(true);
  });

  it('reports an empty lock list when no repos are watched yet', async () => {
    const ctx = buildTestCtx();
    const app = createApp(ctx);

    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body.watchedRepos).toEqual([]);
    expect(res.body.locks).toEqual([]);
  });
});
