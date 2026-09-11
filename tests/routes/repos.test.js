const request = require('supertest');
const nock = require('nock');
const { createApp } = require('../../src/app');
const { createTestDb } = require('../setup');
const { config } = require('../../src/config');

const GITHUB_API = 'https://api.github.com';

function buildTestCtx() {
  const { ticketsRepo, eventsRepo, cursorRepo, lockManager, reposRepo } = createTestDb();
  const poller = { isRunning: () => true, nextPollAt: null };
  return { config, ticketsRepo, eventsRepo, cursorRepo, lockManager, reposRepo, poller };
}

describe('GET /api/repos', () => {
  it('lists only active watched repos', async () => {
    const ctx = buildTestCtx();
    ctx.reposRepo.add('acme', 'widgets');
    ctx.reposRepo.add('acme', 'archived');
    ctx.reposRepo.remove('acme', 'archived');
    const app = createApp(ctx);

    const res = await request(app).get('/api/repos');
    expect(res.status).toBe(200);
    expect(res.body.repos.map((r) => r.name)).toEqual(['widgets']);
  });
});

describe('POST /api/repos', () => {
  beforeEach(() => { nock.disableNetConnect(); nock.enableNetConnect('127.0.0.1'); });
  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
  });

  it('401s without a bearer token', async () => {
    const app = createApp(buildTestCtx());
    const res = await request(app).post('/api/repos').send({ owner: 'acme', name: 'widgets' });
    expect(res.status).toBe(401);
  });

  it('400s when owner/name are missing', async () => {
    const app = createApp(buildTestCtx());
    const res = await request(app)
      .post('/api/repos')
      .set('Authorization', `Bearer ${config.API_TOKEN}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('adds a repo once GitHub confirms it is reachable, auto-filling productionBranch from GitHub\'s default branch', async () => {
    nock(GITHUB_API).get('/repos/acme/widgets').reply(200, { id: 1, default_branch: 'main' });
    const ctx = buildTestCtx();
    const app = createApp(ctx);

    const res = await request(app)
      .post('/api/repos')
      .set('Authorization', `Bearer ${config.API_TOKEN}`)
      .send({ owner: 'acme', name: 'widgets' });

    expect(res.status).toBe(201);
    expect(res.body.repo).toMatchObject({ productionBranch: 'main', stagingBranch: 'staging' });
    expect(ctx.reposRepo.isActive('acme', 'widgets')).toBe(true);
  });

  it('lets an explicit body override the auto-filled branch names', async () => {
    nock(GITHUB_API).get('/repos/acme/widgets').reply(200, { id: 1, default_branch: 'main' });
    const ctx = buildTestCtx();
    const app = createApp(ctx);

    const res = await request(app)
      .post('/api/repos')
      .set('Authorization', `Bearer ${config.API_TOKEN}`)
      .send({ owner: 'acme', name: 'widgets', productionBranch: 'release', stagingBranch: 'qa' });

    expect(res.status).toBe(201);
    expect(res.body.repo).toMatchObject({ productionBranch: 'release', stagingBranch: 'qa' });
  });

  it('400s when productionBranch and stagingBranch would be the same', async () => {
    nock(GITHUB_API).get('/repos/acme/widgets').reply(200, { id: 1, default_branch: 'main' });
    const ctx = buildTestCtx();
    const app = createApp(ctx);

    const res = await request(app)
      .post('/api/repos')
      .set('Authorization', `Bearer ${config.API_TOKEN}`)
      .send({ owner: 'acme', name: 'widgets', productionBranch: 'main', stagingBranch: 'main' });

    expect(res.status).toBe(400);
    expect(ctx.reposRepo.get('acme', 'widgets')).toBeNull();
  });

  it('persists an explicit jiraProjectKey', async () => {
    nock(GITHUB_API).get('/repos/acme/widgets').reply(200, { id: 1, default_branch: 'main' });
    const ctx = buildTestCtx();
    const app = createApp(ctx);

    const res = await request(app)
      .post('/api/repos')
      .set('Authorization', `Bearer ${config.API_TOKEN}`)
      .send({ owner: 'acme', name: 'widgets', jiraProjectKey: 'PROJ' });

    expect(res.status).toBe(201);
    expect(res.body.repo).toMatchObject({ jiraProjectKey: 'PROJ' });
  });

  it('404s and does not add the repo when GitHub reports it does not exist', async () => {
    nock(GITHUB_API).get('/repos/acme/ghost').reply(404);
    const ctx = buildTestCtx();
    const app = createApp(ctx);

    const res = await request(app)
      .post('/api/repos')
      .set('Authorization', `Bearer ${config.API_TOKEN}`)
      .send({ owner: 'acme', name: 'ghost' });

    expect(res.status).toBe(404);
    expect(ctx.reposRepo.get('acme', 'ghost')).toBeNull();
  });
});

describe('PATCH /api/repos/:owner/:name', () => {
  it('401s without a bearer token', async () => {
    const app = createApp(buildTestCtx());
    const res = await request(app).patch('/api/repos/acme/widgets').send({ productionBranch: 'main' });
    expect(res.status).toBe(401);
  });

  it('404s for a repo that is not watched', async () => {
    const app = createApp(buildTestCtx());
    const res = await request(app)
      .patch('/api/repos/acme/widgets')
      .set('Authorization', `Bearer ${config.API_TOKEN}`)
      .send({ productionBranch: 'main' });
    expect(res.status).toBe(404);
  });

  it('updates branch names on a watched repo', async () => {
    const ctx = buildTestCtx();
    ctx.reposRepo.add('acme', 'widgets');
    const app = createApp(ctx);

    const res = await request(app)
      .patch('/api/repos/acme/widgets')
      .set('Authorization', `Bearer ${config.API_TOKEN}`)
      .send({ productionBranch: 'main', stagingBranch: 'qa' });

    expect(res.status).toBe(200);
    expect(res.body.repo).toMatchObject({ productionBranch: 'main', stagingBranch: 'qa' });
  });

  it('400s when the update would make productionBranch equal stagingBranch', async () => {
    const ctx = buildTestCtx();
    ctx.reposRepo.add('acme', 'widgets', { productionBranch: 'develop', stagingBranch: 'staging' });
    const app = createApp(ctx);

    const res = await request(app)
      .patch('/api/repos/acme/widgets')
      .set('Authorization', `Bearer ${config.API_TOKEN}`)
      .send({ productionBranch: 'staging' }); // collides with the existing stagingBranch

    expect(res.status).toBe(400);
    expect(ctx.reposRepo.get('acme', 'widgets').productionBranch).toBe('develop');
  });

  it('sets a jiraProjectKey on a watched repo', async () => {
    const ctx = buildTestCtx();
    ctx.reposRepo.add('acme', 'widgets');
    const app = createApp(ctx);

    const res = await request(app)
      .patch('/api/repos/acme/widgets')
      .set('Authorization', `Bearer ${config.API_TOKEN}`)
      .send({ jiraProjectKey: 'PROJ' });

    expect(res.status).toBe(200);
    expect(res.body.repo.jiraProjectKey).toBe('PROJ');
  });

  it('clears jiraProjectKey when sent as an empty string', async () => {
    const ctx = buildTestCtx();
    ctx.reposRepo.add('acme', 'widgets', { jiraProjectKey: 'PROJ' });
    const app = createApp(ctx);

    const res = await request(app)
      .patch('/api/repos/acme/widgets')
      .set('Authorization', `Bearer ${config.API_TOKEN}`)
      .send({ jiraProjectKey: '' });

    expect(res.status).toBe(200);
    expect(res.body.repo.jiraProjectKey).toBeNull();
  });

  it('leaves jiraProjectKey unchanged when omitted from the request body', async () => {
    const ctx = buildTestCtx();
    ctx.reposRepo.add('acme', 'widgets', { jiraProjectKey: 'PROJ' });
    const app = createApp(ctx);

    const res = await request(app)
      .patch('/api/repos/acme/widgets')
      .set('Authorization', `Bearer ${config.API_TOKEN}`)
      .send({ productionBranch: 'main' });

    expect(res.status).toBe(200);
    expect(res.body.repo.jiraProjectKey).toBe('PROJ');
  });

  it('reclassifies linked tickets when staging/production branches change', async () => {
    const ctx = buildTestCtx();
    ctx.reposRepo.add('acme', 'widgets', {
      productionBranch: 'release-4.3.0-v1',
      stagingBranch: 'staging',
      jiraProjectKey: 'VIM',
    });
    ctx.ticketsRepo.upsert({
      key: 'VIM-115',
      jiraStatus: 'In Progress',
      pipelineState: 'queued',
      repoOwner: 'acme',
      repoName: 'widgets',
      branchName: 'VIM-115',
      prNumber: 175,
      prState: 'open',
    });
    ctx.repoResolver = {
      getClient: () => ({
        getPr: async () => ({
          number: 175,
          state: 'open',
          merged: false,
          base: 'release-4.3.0-v1',
          head: 'VIM-115',
          headSha: 'abc',
        }),
      }),
      getMatcher: () => ({}),
      resolveTicket: async () => ({ found: true }),
      matchByProjectKeyOnly: () => null,
      invalidateAll: () => {},
    };
    ctx.logger = { info: () => {}, warn: () => {}, error: () => {}, child() { return this; } };
    const app = createApp(ctx);

    const res = await request(app)
      .patch('/api/repos/acme/widgets')
      .set('Authorization', `Bearer ${config.API_TOKEN}`)
      .send({ productionBranch: 'prod', stagingBranch: 'develop' });

    expect(res.status).toBe(200);
    expect(res.body.repo).toMatchObject({ productionBranch: 'prod', stagingBranch: 'develop' });
    expect(res.body.reclassified).toEqual([
      expect.objectContaining({
        ticketKey: 'VIM-115',
        nextState: 'unmerged',
        detached: true,
      }),
    ]);
    expect(ctx.ticketsRepo.get('VIM-115').pipeline_state).toBe('unmerged');
    expect(ctx.ticketsRepo.get('VIM-115').pr_number).toBeNull();
  });
});

describe('DELETE /api/repos/:owner/:name', () => {
  it('401s without a bearer token', async () => {
    const app = createApp(buildTestCtx());
    const res = await request(app).delete('/api/repos/acme/widgets');
    expect(res.status).toBe(401);
  });

  it('soft-removes a watched repo', async () => {
    const ctx = buildTestCtx();
    ctx.reposRepo.add('acme', 'widgets');
    const app = createApp(ctx);

    const res = await request(app)
      .delete('/api/repos/acme/widgets')
      .set('Authorization', `Bearer ${config.API_TOKEN}`);

    expect(res.status).toBe(204);
    expect(ctx.reposRepo.isActive('acme', 'widgets')).toBe(false);
  });
});

describe('GET /api/github/repos', () => {
  beforeEach(() => { nock.disableNetConnect(); nock.enableNetConnect('127.0.0.1'); });
  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
  });

  it('401s without a bearer token', async () => {
    const app = createApp(buildTestCtx());
    const res = await request(app).get('/api/github/repos');
    expect(res.status).toBe(401);
  });

  it('lists repos accessible to the token and flags which are already watched', async () => {
    nock(GITHUB_API)
      .get('/user/repos')
      .query(true)
      .reply(200, [
        { owner: { login: 'acme' }, name: 'widgets', full_name: 'acme/widgets', private: false, default_branch: 'main' },
        { owner: { login: 'acme' }, name: 'other', full_name: 'acme/other', private: true, default_branch: 'main' },
      ]);
    const ctx = buildTestCtx();
    ctx.reposRepo.add('acme', 'widgets');
    const app = createApp(ctx);

    const res = await request(app).get('/api/github/repos').set('Authorization', `Bearer ${config.API_TOKEN}`);
    expect(res.status).toBe(200);
    const byName = Object.fromEntries(res.body.repos.map((r) => [r.name, r.watched]));
    expect(byName.widgets).toBe(true);
    expect(byName.other).toBe(false);
  });
});

describe('GET /api/github/repos/:owner/:name/branches', () => {
  beforeEach(() => { nock.disableNetConnect(); nock.enableNetConnect('127.0.0.1'); });
  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
  });

  it('401s without a bearer token', async () => {
    const app = createApp(buildTestCtx());
    const res = await request(app).get('/api/github/repos/acme/widgets/branches');
    expect(res.status).toBe(401);
  });

  it('lists branch names for the given repo', async () => {
    nock(GITHUB_API)
      .get('/repos/acme/widgets/branches')
      .query(true)
      .reply(200, [{ name: 'main' }, { name: 'staging' }, { name: 'feat/x' }]);
    const app = createApp(buildTestCtx());

    const res = await request(app)
      .get('/api/github/repos/acme/widgets/branches')
      .set('Authorization', `Bearer ${config.API_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.branches).toEqual(['main', 'staging', 'feat/x']);
  });

  it("400s and never calls GitHub when the name segment smuggles an extra path segment (encoded slash)", async () => {
    // %2F decodes to a literal "/" in the :name param without splitting
    // the route into extra segments — exactly the shape that would splice
    // an unintended path onto the outgoing GitHub fetch() URL if unchecked.
    // No nock interceptor is registered: if the handler used the raw value,
    // this would fail on "Disallowed net connect" instead of asserting 400.
    const app = createApp(buildTestCtx());

    const res = await request(app)
      .get('/api/github/repos/acme/widgets%2F..%2Fsecrets/branches')
      .set('Authorization', `Bearer ${config.API_TOKEN}`);
    expect(res.status).toBe(400);
  });
});
