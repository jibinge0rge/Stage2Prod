const request = require('supertest');
const { createApp } = require('../../src/app');
const { createTestDb, seedTicket, noopLogger, fakeRepoResolver, fakeDisplayGithub } = require('../setup');
const { config } = require('../../src/config');

function notFound() {
  const err = new Error('Not Found');
  err.status = 404;
  return err;
}

async function buildTestCtx(github) {
  const { ticketsRepo, eventsRepo, cursorRepo, lockManager, reposRepo, cutsRepo } = await createTestDb();
  await reposRepo.add('acme', 'widgets', { productionBranch: 'main', stagingBranch: 'qa' });
  await seedTicket(ticketsRepo, {
    key: 'PROJ-1',
    summary: 'Login',
    jiraStatus: 'In QA',
    pipelineState: 'staging',
    repoOwner: 'acme',
    repoName: 'widgets',
    branchName: 'feat/PROJ-1-login',
  });
  const client = github || {
    getRef: vi.fn(async (branch) => {
      if (branch === 'qa') return 'stagingsha';
      if (branch === 'main') return 'prodsha';
      throw notFound();
    }),
    listCommitsAhead: vi.fn().mockResolvedValue([
      { sha: 'c1', commit: { message: 'Merge pull request #12 from acme/feat/PROJ-1-login' } },
    ]),
    createRef: vi.fn().mockResolvedValue({ sha: 'stagingsha' }),
  };
  return {
    config,
    ticketsRepo,
    eventsRepo,
    cursorRepo,
    lockManager,
    reposRepo,
    cutsRepo,
    logger: noopLogger,
    poller: { isRunning: () => true, nextPollAt: null },
    repoResolver: fakeRepoResolver({ getClient: () => client }),
    displayGithub: fakeDisplayGithub({ getClient: () => client }),
    github: client,
  };
}

describe('GET /api/repos/:owner/:name/cuts', () => {
  it('lists cuts newest first', async () => {
    const ctx = await buildTestCtx();
    await ctx.cutsRepo.insert({
      repoOwner: 'acme',
      repoName: 'widgets',
      branchName: 'release-4.2.0',
      sha: 'aaa',
      stagingSha: 'aaa',
      createdAt: '2026-09-01T00:00:00.000Z',
      tickets: [{ key: 'PROJ-1', summary: 'Login' }],
    });
    await ctx.cutsRepo.insert({
      repoOwner: 'acme',
      repoName: 'widgets',
      branchName: 'release-4.3.0-v1',
      sha: 'bbb',
      stagingSha: 'bbb',
      createdAt: '2026-09-14T00:00:00.000Z',
      tickets: [{ key: 'PROJ-1', summary: 'Login' }],
    });
    const app = createApp(ctx);
    const res = await request(app).get('/api/repos/acme/widgets/cuts');
    expect(res.status).toBe(200);
    expect(res.body.cuts.map((c) => c.branchName)).toEqual(['release-4.3.0-v1', 'release-4.2.0']);
    expect(res.body.cuts[0]).toMatchObject({ isLatest: true, ticketCount: 1 });
    expect(res.body.cuts[1].isLatest).toBe(false);
  });

  it('404s for an unknown repo', async () => {
    const app = createApp(await buildTestCtx());
    const res = await request(app).get('/api/repos/nope/nope/cuts');
    expect(res.status).toBe(404);
  });
});

describe('GET /api/repos/:owner/:name/cuts/:id', () => {
  it('returns tickets that went from staging in that cut', async () => {
    const ctx = await buildTestCtx();
    const cut = await ctx.cutsRepo.insert({
      repoOwner: 'acme',
      repoName: 'widgets',
      branchName: 'release-4.3.0-v1',
      sha: 'bbb',
      stagingSha: 'bbb',
      tickets: [{ key: 'PROJ-1', summary: 'Login' }],
    });
    const app = createApp(ctx);
    const res = await request(app).get(`/api/repos/acme/widgets/cuts/${cut.id}`);
    expect(res.status).toBe(200);
    expect(res.body.cut.tickets).toEqual([
      expect.objectContaining({ key: 'PROJ-1', summary: 'Login', pipelineState: 'staging' }),
    ]);
  });
});

describe('POST /api/repos/:owner/:name/cuts', () => {
  it('401s without a bearer token', async () => {
    const app = createApp(await buildTestCtx());
    const res = await request(app).post('/api/repos/acme/widgets/cuts').send({ name: 'prod-x' });
    expect(res.status).toBe(401);
  });

  it('creates a cut from staging and returns its tickets', async () => {
    const ctx = await buildTestCtx();
    const app = createApp(ctx);
    const res = await request(app)
      .post('/api/repos/acme/widgets/cuts')
      .set('Authorization', `Bearer ${config.API_TOKEN}`)
      .send({ name: 'release-4.3.0-v1' });

    expect(res.status).toBe(201);
    expect(res.body.cut).toMatchObject({ branchName: 'release-4.3.0-v1', sha: 'stagingsha' });
    expect(res.body.cut.tickets.map((t) => t.key)).toEqual(['PROJ-1']);
    expect(ctx.github.createRef).toHaveBeenCalledWith('release-4.3.0-v1', 'stagingsha');
  });
});
