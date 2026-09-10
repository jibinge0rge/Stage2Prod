const request = require('supertest');
const { createApp } = require('../../src/app');
const { createTestDb, noopLogger } = require('../setup');
const { config } = require('../../src/config');

function buildTestCtx(overrides = {}) {
  const { ticketsRepo, eventsRepo, cursorRepo, lockManager, reposRepo } = createTestDb();
  const poller = { isRunning: () => true, nextPollAt: null, pollNow: vi.fn().mockResolvedValue(undefined) };
  const jira = {
    getTransitions: vi.fn().mockResolvedValue([{ id: '1', name: 'Ready for QA' }, { id: '2', name: 'Done' }]),
    transition: vi.fn().mockResolvedValue({ transitioned: true }),
    addComment: vi.fn().mockResolvedValue({ commented: true }),
    tryTransition: vi.fn().mockResolvedValue({ transitioned: true }),
  };
  const repoResolver = {
    getClient: vi.fn(() => ({})),
    matchByProjectKeyOnly: vi.fn(() => null),
    getMatcher: vi.fn(() => ({})),
  };
  return { config, ticketsRepo, eventsRepo, cursorRepo, lockManager, reposRepo, poller, jira, repoResolver, logger: noopLogger, ...overrides };
}

describe('GET /api/tickets', () => {
  it('lists tickets and supports search + state filters', async () => {
    const ctx = buildTestCtx();
    ctx.ticketsRepo.upsert({ key: 'PROJ-1', summary: 'Fix login', jiraStatus: 'In QA', pipelineState: 'staging' });
    ctx.ticketsRepo.upsert({ key: 'PROJ-2', summary: 'Add export', jiraStatus: 'Done', pipelineState: 'develop' });
    const app = createApp(ctx);

    const all = await request(app).get('/api/tickets');
    expect(all.body.total).toBe(2);

    const filtered = await request(app).get('/api/tickets?state=staging');
    expect(filtered.body.tickets.map((t) => t.key)).toEqual(['PROJ-1']);

    const searched = await request(app).get('/api/tickets?q=export');
    expect(searched.body.tickets.map((t) => t.key)).toEqual(['PROJ-2']);
  });

  it('includes the resolved repo (with its configured branch names) per ticket, and supports ?repo= filtering', async () => {
    const ctx = buildTestCtx();
    ctx.reposRepo.add('acme', 'widgets', { productionBranch: 'main', stagingBranch: 'qa' });
    ctx.ticketsRepo.upsert({ key: 'PROJ-1', jiraStatus: 'In QA', pipelineState: 'staging', repoOwner: 'acme', repoName: 'widgets' });
    ctx.ticketsRepo.upsert({ key: 'PROJ-2', jiraStatus: 'In QA', pipelineState: 'staging', repoOwner: 'other', repoName: 'repo' });
    ctx.ticketsRepo.upsert({ key: 'PROJ-3', jiraStatus: 'In Development', pipelineState: 'unmerged' }); // not yet resolved
    const app = createApp(ctx);

    const all = await request(app).get('/api/tickets');
    const byKey = Object.fromEntries(all.body.tickets.map((t) => [t.key, t.repo]));
    expect(byKey['PROJ-1']).toEqual({ owner: 'acme', name: 'widgets', productionBranch: 'main', stagingBranch: 'qa' });
    // PROJ-2's repo was never registered in reposRepo — falls back to the app defaults rather than crashing.
    expect(byKey['PROJ-2']).toEqual({ owner: 'other', name: 'repo', productionBranch: 'develop', stagingBranch: 'staging' });
    expect(byKey['PROJ-3']).toBeNull();

    const filtered = await request(app).get('/api/tickets?repo=acme/widgets');
    expect(filtered.body.tickets.map((t) => t.key)).toEqual(['PROJ-1']);
  });

  it('GET /api/tickets/:key includes an orchestration timeline from events', async () => {
    const ctx = buildTestCtx();
    ctx.ticketsRepo.upsert({ key: 'PROJ-1', summary: 'Fix login', jiraStatus: 'In QA', pipelineState: 'staging' });
    ctx.eventsRepo.insertEvent({ ticketKey: 'PROJ-1', trigger: 'Poll', action: 'merge:staging', outcome: 'MERGED', title: 'Merged into staging' });
    const app = createApp(ctx);

    const res = await request(app).get('/api/tickets/PROJ-1');
    expect(res.status).toBe(200);
    expect(res.body.timeline).toHaveLength(1);
    expect(res.body.timeline[0].title).toBe('Merged into staging');
    expect(res.body.aheadOfStaging).toBe(0);
    expect(res.body.aheadOfProduction).toBe(0);
  });

  it('GET /api/tickets/:key reports how far the feature branch is ahead of staging and production', async () => {
    const ctx = buildTestCtx();
    ctx.reposRepo.add('acme', 'widgets', { productionBranch: 'main', stagingBranch: 'qa' });
    ctx.ticketsRepo.upsert({
      key: 'PROJ-1',
      summary: 'Fix login',
      jiraStatus: 'In Development',
      pipelineState: 'unmerged',
      repoOwner: 'acme',
      repoName: 'widgets',
    });
    ctx.ticketsRepo.setGithubFacts('PROJ-1', { branchName: 'feat/PROJ-1-login' });
    ctx.repoResolver.getClient = vi.fn(() => ({
      compareCommits: vi
        .fn()
        .mockImplementation(async (base) =>
          base === 'qa' ? { aheadBy: 2, behindBy: 0 } : { aheadBy: 5, behindBy: 0 }
        ),
    }));
    const app = createApp(ctx);

    const res = await request(app).get('/api/tickets/PROJ-1');
    expect(res.status).toBe(200);
    expect(res.body.aheadOfStaging).toBe(2);
    expect(res.body.aheadOfProduction).toBe(5);
  });

  it('404s for an unknown ticket key', async () => {
    const ctx = buildTestCtx();
    const app = createApp(ctx);
    const res = await request(app).get('/api/tickets/NOPE-1');
    expect(res.status).toBe(404);
  });
});

describe('GET /api/tickets/:key/transitions', () => {
  it('returns the available Jira transitions for the ticket', async () => {
    const ctx = buildTestCtx();
    ctx.ticketsRepo.upsert({ key: 'PROJ-1', jiraStatus: 'In Development', pipelineState: 'unmerged' });
    const app = createApp(ctx);

    const res = await request(app).get('/api/tickets/PROJ-1/transitions');
    expect(res.status).toBe(200);
    expect(res.body.transitions).toEqual([{ id: '1', name: 'Ready for QA' }, { id: '2', name: 'Done' }]);
  });

  it('404s for an unknown ticket', async () => {
    const app = createApp(buildTestCtx());
    const res = await request(app).get('/api/tickets/NOPE-1/transitions');
    expect(res.status).toBe(404);
  });
});

describe('POST /api/tickets/:key/transition', () => {
  it('401s without a bearer token', async () => {
    const ctx = buildTestCtx();
    ctx.ticketsRepo.upsert({ key: 'PROJ-1', jiraStatus: 'In Development', pipelineState: 'unmerged' });
    const app = createApp(ctx);
    const res = await request(app).post('/api/tickets/PROJ-1/transition').send({ name: 'Done' });
    expect(res.status).toBe(401);
  });

  it('transitions the ticket in Jira and triggers an immediate poll so the effect shows up right away', async () => {
    const ctx = buildTestCtx();
    ctx.ticketsRepo.upsert({ key: 'PROJ-1', jiraStatus: 'In Development', pipelineState: 'unmerged' });
    const app = createApp(ctx);

    const res = await request(app)
      .post('/api/tickets/PROJ-1/transition')
      .set('Authorization', `Bearer ${config.API_TOKEN}`)
      .send({ name: 'Done' });

    expect(res.status).toBe(200);
    expect(ctx.jira.transition).toHaveBeenCalledWith('PROJ-1', 'Done');
    expect(ctx.poller.pollNow).toHaveBeenCalledTimes(1);
  });

  it('400s when Jira reports the transition is not available', async () => {
    const ctx = buildTestCtx({ jira: { transition: vi.fn().mockResolvedValue({ transitioned: false }), getTransitions: vi.fn(), addComment: vi.fn() } });
    ctx.ticketsRepo.upsert({ key: 'PROJ-1', jiraStatus: 'In Development', pipelineState: 'unmerged' });
    const app = createApp(ctx);

    const res = await request(app)
      .post('/api/tickets/PROJ-1/transition')
      .set('Authorization', `Bearer ${config.API_TOKEN}`)
      .send({ name: 'Not A Real Status' });

    expect(res.status).toBe(400);
    expect(ctx.poller.pollNow).not.toHaveBeenCalled();
  });

  it('400s when "name" is missing', async () => {
    const ctx = buildTestCtx();
    ctx.ticketsRepo.upsert({ key: 'PROJ-1', jiraStatus: 'In Development', pipelineState: 'unmerged' });
    const app = createApp(ctx);

    const res = await request(app)
      .post('/api/tickets/PROJ-1/transition')
      .set('Authorization', `Bearer ${config.API_TOKEN}`)
      .send({});
    expect(res.status).toBe(400);
  });
});

describe('POST /api/tickets/:key/comment', () => {
  it('401s without a bearer token', async () => {
    const ctx = buildTestCtx();
    ctx.ticketsRepo.upsert({ key: 'PROJ-1', jiraStatus: 'In Development', pipelineState: 'unmerged' });
    const app = createApp(ctx);
    const res = await request(app).post('/api/tickets/PROJ-1/comment').send({ text: 'hi' });
    expect(res.status).toBe(401);
  });

  it('posts a comment to Jira', async () => {
    const ctx = buildTestCtx();
    ctx.ticketsRepo.upsert({ key: 'PROJ-1', jiraStatus: 'In Development', pipelineState: 'unmerged' });
    const app = createApp(ctx);

    const res = await request(app)
      .post('/api/tickets/PROJ-1/comment')
      .set('Authorization', `Bearer ${config.API_TOKEN}`)
      .send({ text: 'Looks good' });

    expect(res.status).toBe(201);
    expect(ctx.jira.addComment).toHaveBeenCalledWith('PROJ-1', 'Looks good');
  });

  it('400s when text is missing or blank', async () => {
    const ctx = buildTestCtx();
    ctx.ticketsRepo.upsert({ key: 'PROJ-1', jiraStatus: 'In Development', pipelineState: 'unmerged' });
    const app = createApp(ctx);

    const res = await request(app)
      .post('/api/tickets/PROJ-1/comment')
      .set('Authorization', `Bearer ${config.API_TOKEN}`)
      .send({ text: '   ' });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/tickets/:key/merge', () => {
  it('401s without a bearer token', async () => {
    const app = createApp(buildTestCtx());
    const res = await request(app).post('/api/tickets/PROJ-1/merge').send({});
    expect(res.status).toBe(401);
  });

  it('404s for an unknown ticket', async () => {
    const app = createApp(buildTestCtx());
    const res = await request(app)
      .post('/api/tickets/NOPE-1/merge')
      .set('Authorization', `Bearer ${config.API_TOKEN}`)
      .send({});
    expect(res.status).toBe(404);
  });

  it('400s when the ticket has nothing awaiting merge', async () => {
    const ctx = buildTestCtx();
    ctx.reposRepo.add('acme', 'widgets');
    ctx.ticketsRepo.upsert({ key: 'PROJ-1', jiraStatus: 'In Development', pipelineState: 'unmerged', repoOwner: 'acme', repoName: 'widgets' });
    const app = createApp(ctx);

    const res = await request(app)
      .post('/api/tickets/PROJ-1/merge')
      .set('Authorization', `Bearer ${config.API_TOKEN}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('merges the open staging PR and returns the updated ticket', async () => {
    const ctx = buildTestCtx();
    ctx.reposRepo.add('acme', 'widgets', { productionBranch: 'main', stagingBranch: 'qa' });
    ctx.ticketsRepo.upsert({ key: 'PROJ-1', jiraStatus: 'In QA', pipelineState: 'staging_queued', repoOwner: 'acme', repoName: 'widgets' });
    ctx.ticketsRepo.setGithubFacts('PROJ-1', { prNumber: 7, branchName: 'feat/PROJ-1-thing' });
    const github = {
      getPr: vi.fn().mockResolvedValue({ number: 7, state: 'open', merged: false, base: 'qa', head: 'feat/PROJ-1-thing', mergeable: true }),
      mergePr: vi.fn().mockResolvedValue({ merged: true, sha: 'sha1' }),
      deleteRef: vi.fn(),
    };
    ctx.repoResolver.getClient = vi.fn(() => github);
    const app = createApp(ctx);

    const res = await request(app)
      .post('/api/tickets/PROJ-1/merge')
      .set('Authorization', `Bearer ${config.API_TOKEN}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.pipelineState).toBe('staging');
    expect(github.mergePr).toHaveBeenCalledWith(7, { mergeMethod: 'merge' });
    expect(github.deleteRef).not.toHaveBeenCalled();
  });
});

describe('POST /api/tickets/:key/branch', () => {
  it('401s without a bearer token', async () => {
    const app = createApp(buildTestCtx());
    const res = await request(app).post('/api/tickets/PROJ-1/branch').send({});
    expect(res.status).toBe(401);
  });

  it('404s for an unknown ticket', async () => {
    const app = createApp(buildTestCtx());
    const res = await request(app)
      .post('/api/tickets/NOPE-1/branch')
      .set('Authorization', `Bearer ${config.API_TOKEN}`)
      .send({});
    expect(res.status).toBe(404);
  });

  it('creates a branch from production and returns the updated ticket', async () => {
    const ctx = buildTestCtx();
    ctx.reposRepo.add('acme', 'widgets', { productionBranch: 'main', stagingBranch: 'qa' });
    ctx.ticketsRepo.upsert({
      key: 'PROJ-1',
      summary: 'Fix login',
      jiraStatus: 'In Development',
      pipelineState: 'unmerged',
      repoOwner: 'acme',
      repoName: 'widgets',
    });
    const github = {
      getRef: vi.fn(async (branch) => {
        if (branch === 'main') return 'prodsha1';
        const err = new Error('Not Found');
        err.status = 404;
        throw err;
      }),
      createRef: vi.fn().mockResolvedValue({ sha: 'prodsha1' }),
    };
    ctx.repoResolver.getClient = vi.fn(() => github);
    ctx.repoResolver.matchByProjectKeyOnly = vi.fn(() => null);
    const app = createApp(ctx);

    const res = await request(app)
      .post('/api/tickets/PROJ-1/branch')
      .set('Authorization', `Bearer ${config.API_TOKEN}`)
      .send({ name: 'feat/PROJ-1-login' });

    expect(res.status).toBe(201);
    expect(res.body.branch).toBe('feat/PROJ-1-login');
    expect(res.body.jiraStatus).toBe('In Progress');
    expect(github.createRef).toHaveBeenCalledWith('feat/PROJ-1-login', 'prodsha1');
    expect(ctx.jira.addComment).toHaveBeenCalled();
    expect(ctx.jira.tryTransition).toHaveBeenCalledWith('PROJ-1', 'In Progress');
  });

  it('400s when the branch name does not contain the ticket key', async () => {
    const ctx = buildTestCtx();
    ctx.reposRepo.add('acme', 'widgets');
    ctx.ticketsRepo.upsert({
      key: 'PROJ-1',
      jiraStatus: 'In Development',
      pipelineState: 'unmerged',
      repoOwner: 'acme',
      repoName: 'widgets',
    });
    ctx.repoResolver.matchByProjectKeyOnly = vi.fn(() => null);
    const app = createApp(ctx);

    const res = await request(app)
      .post('/api/tickets/PROJ-1/branch')
      .set('Authorization', `Bearer ${config.API_TOKEN}`)
      .send({ name: 'feat/unrelated' });

    expect(res.status).toBe(400);
  });
});

describe('POST /api/tickets/:key/pr', () => {
  it('401s without a bearer token', async () => {
    const app = createApp(buildTestCtx());
    const res = await request(app).post('/api/tickets/PROJ-1/pr').send({ target: 'staging' });
    expect(res.status).toBe(401);
  });

  it('404s for an unknown ticket', async () => {
    const app = createApp(buildTestCtx());
    const res = await request(app)
      .post('/api/tickets/NOPE-1/pr')
      .set('Authorization', `Bearer ${config.API_TOKEN}`)
      .send({ target: 'staging' });
    expect(res.status).toBe(404);
  });

  it('opens a staging PR and returns the ticket in staging_queued', async () => {
    const ctx = buildTestCtx();
    ctx.reposRepo.add('acme', 'widgets', { productionBranch: 'main', stagingBranch: 'qa' });
    ctx.ticketsRepo.upsert({
      key: 'PROJ-1',
      summary: 'Fix login',
      jiraStatus: 'In Development',
      pipelineState: 'unmerged',
      repoOwner: 'acme',
      repoName: 'widgets',
    });
    ctx.ticketsRepo.setGithubFacts('PROJ-1', { branchName: 'feat/PROJ-1-login' });
    const github = {
      createPr: vi.fn().mockResolvedValue({ number: 42, htmlUrl: 'https://x/42', headSha: 'headsha1' }),
      compareCommits: vi.fn().mockResolvedValue({ aheadBy: 2, behindBy: 0 }),
    };
    ctx.repoResolver.getClient = vi.fn(() => github);
    ctx.repoResolver.getMatcher = vi.fn(() => ({
      findBranchForTicket: vi.fn().mockResolvedValue('feat/PROJ-1-login'),
      findOpenPrForTicket: vi.fn().mockResolvedValue(null),
    }));
    const app = createApp(ctx);

    const res = await request(app)
      .post('/api/tickets/PROJ-1/pr')
      .set('Authorization', `Bearer ${config.API_TOKEN}`)
      .send({ target: 'staging' });

    expect(res.status).toBe(201);
    expect(res.body.pipelineState).toBe('staging_queued');
    expect(res.body.prNumber).toBe(42);
    expect(res.body.jiraStatus).toBe('In QA');
    expect(github.createPr).toHaveBeenCalledWith(expect.objectContaining({ base: 'qa', head: 'feat/PROJ-1-login' }));
    expect(ctx.jira.tryTransition).toHaveBeenCalledWith('PROJ-1', 'In QA');
  });

  it('400s when the branch has no commits ahead of the target', async () => {
    const ctx = buildTestCtx();
    ctx.reposRepo.add('acme', 'widgets', { productionBranch: 'main', stagingBranch: 'qa' });
    ctx.ticketsRepo.upsert({
      key: 'PROJ-1',
      jiraStatus: 'In Development',
      pipelineState: 'unmerged',
      repoOwner: 'acme',
      repoName: 'widgets',
    });
    ctx.ticketsRepo.setGithubFacts('PROJ-1', { branchName: 'feat/PROJ-1-login' });
    const github = {
      createPr: vi.fn(),
      compareCommits: vi.fn().mockResolvedValue({ aheadBy: 0, behindBy: 0 }),
    };
    ctx.repoResolver.getClient = vi.fn(() => github);
    ctx.repoResolver.getMatcher = vi.fn(() => ({
      findBranchForTicket: vi.fn().mockResolvedValue('feat/PROJ-1-login'),
      findOpenPrForTicket: vi.fn().mockResolvedValue(null),
    }));
    const app = createApp(ctx);

    const res = await request(app)
      .post('/api/tickets/PROJ-1/pr')
      .set('Authorization', `Bearer ${config.API_TOKEN}`)
      .send({ target: 'staging' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/no commits/i);
    expect(github.createPr).not.toHaveBeenCalled();
  });

  it('400s when target is missing or invalid', async () => {
    const ctx = buildTestCtx();
    ctx.reposRepo.add('acme', 'widgets');
    ctx.ticketsRepo.upsert({
      key: 'PROJ-1',
      jiraStatus: 'In Development',
      pipelineState: 'unmerged',
      repoOwner: 'acme',
      repoName: 'widgets',
    });
    const app = createApp(ctx);

    const res = await request(app)
      .post('/api/tickets/PROJ-1/pr')
      .set('Authorization', `Bearer ${config.API_TOKEN}`)
      .send({});
    expect(res.status).toBe(400);
  });
});
