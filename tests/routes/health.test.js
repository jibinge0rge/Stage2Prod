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
      { owner: 'acme', name: 'widgets', productionBranch: 'main', stagingBranch: 'qa', jiraProjectKey: null },
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

  it('jiraJql falls back to config.JIRA_JQL when no watched repo has a Jira project key', async () => {
    const ctx = buildTestCtx();
    ctx.reposRepo.add('acme', 'widgets');
    const app = createApp(ctx);

    const res = await request(app).get('/api/health');
    expect(res.body.jiraJql).toBe(config.JIRA_JQL);
  });

  it('jiraJql is built from watched repos\' Jira project keys once any are configured', async () => {
    const ctx = buildTestCtx();
    ctx.reposRepo.add('acme', 'widgets', { jiraProjectKey: 'PROJ' });
    const app = createApp(ctx);

    const res = await request(app).get('/api/health');
    expect(res.body.jiraJql).toBe(`project in ("PROJ") AND ${config.JIRA_POLL_CLAUSE} ORDER BY updated ASC`);
    expect(res.body.watchedRepos[0].jiraProjectKey).toBe('PROJ');
  });

  it('includes the configured Jira email', async () => {
    const ctx = buildTestCtx({ config: { ...config, JIRA_EMAIL: 'jibin.george@work.com' } });
    const app = createApp(ctx);

    const res = await request(app).get('/api/health');
    expect(res.body.jiraEmail).toBe('jibin.george@work.com');
  });
});

describe('POST /api/sync', () => {
  it('401s without a bearer token', async () => {
    const app = createApp(buildTestCtx());
    const res = await request(app).post('/api/sync').send({});
    expect(res.status).toBe(401);
  });

  it('runs a Jira poll immediately so the UI does not wait for the timer', async () => {
    const poller = {
      isRunning: () => true,
      nextPollAt: '2026-04-20T15:00:00.000Z',
      pollNow: vi.fn().mockResolvedValue(undefined),
    };
    const ctx = buildTestCtx({ poller });
    const app = createApp(ctx);

    const res = await request(app)
      .post('/api/sync')
      .set('Authorization', `Bearer ${config.API_TOKEN}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.polled).toBe(true);
    expect(poller.pollNow).toHaveBeenCalledTimes(1);
  });
});
