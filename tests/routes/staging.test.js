const request = require('supertest');
const { createApp } = require('../../src/app');
const { createTestDb, noopLogger } = require('../setup');
const { config } = require('../../src/config');

const REPO = { owner: 'acme', name: 'widgets' };

function buildTestCtx() {
  const { ticketsRepo, eventsRepo, cursorRepo, lockManager, reposRepo } = createTestDb();
  reposRepo.add(REPO.owner, REPO.name);

  const github = {
    rateLimit: {},
    getRef: vi.fn((branch) => Promise.resolve(branch === 'develop' ? 'develop-sha' : 'staging-sha')),
    updateRef: vi.fn().mockResolvedValue({ sha: 'develop-sha' }),
    createMerge: vi.fn().mockResolvedValue({ conflict: false, sha: 'remerge-sha' }),
  };
  const jira = { addComment: vi.fn().mockResolvedValue({ commented: true }), tryTransition: vi.fn() };
  const ticketMatcher = { findBranchForTicket: vi.fn().mockResolvedValue('feat/PROJ-1-thing') };
  const repoResolver = {
    getClient: vi.fn(() => github),
    getMatcher: vi.fn(() => ticketMatcher),
  };
  const poller = { isRunning: () => true, nextPollAt: null };
  return { config, ticketsRepo, eventsRepo, cursorRepo, lockManager, reposRepo, repoResolver, jira, poller, logger: noopLogger, github, ticketMatcher };
}

describe('POST /api/staging/reset', () => {
  it('401s without a bearer token', async () => {
    const app = createApp(buildTestCtx());
    const res = await request(app).post('/api/staging/reset').send(REPO);
    expect(res.status).toBe(401);
  });

  it('401s with the wrong token', async () => {
    const app = createApp(buildTestCtx());
    const res = await request(app).post('/api/staging/reset').set('Authorization', 'Bearer wrong').send(REPO);
    expect(res.status).toBe(401);
  });

  it('400s when owner/name are missing', async () => {
    const app = createApp(buildTestCtx());
    const res = await request(app)
      .post('/api/staging/reset')
      .set('Authorization', `Bearer ${config.API_TOKEN}`)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('bad_request');
  });

  it('400s when the repo is not watched', async () => {
    const app = createApp(buildTestCtx());
    const res = await request(app)
      .post('/api/staging/reset')
      .set('Authorization', `Bearer ${config.API_TOKEN}`)
      .send({ owner: 'someone', name: 'else' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('unknown_repo');
  });

  it('force-updates staging to develop and records a RESET event', async () => {
    const ctx = buildTestCtx();
    const app = createApp(ctx);

    const res = await request(app)
      .post('/api/staging/reset')
      .set('Authorization', `Bearer ${config.API_TOKEN}`)
      .send({ ...REPO, remergeInQa: false });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.newHeadSha).toBe('develop-sha');
    expect(ctx.github.updateRef).toHaveBeenCalledWith('staging', 'develop-sha', { force: true });

    const { events } = ctx.eventsRepo.list({ outcome: 'RESET' });
    expect(events).toHaveLength(1);
    expect(events[0].repo).toEqual(REPO);
  });

  it('returns 409 when the staging lock for that repo is already held', async () => {
    const ctx = buildTestCtx();
    const app = createApp(ctx);

    let releaseHold;
    const held = new Promise((resolve) => { releaseHold = resolve; });
    const holdingPromise = ctx.lockManager.withLock('acme/widgets#refs/heads/staging', 'someone-else', 'corr-x', () => held);
    await new Promise((r) => setTimeout(r, 5));

    const res = await request(app)
      .post('/api/staging/reset')
      .set('Authorization', `Bearer ${config.API_TOKEN}`)
      .send(REPO);

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('staging_locked');

    releaseHold();
    await holdingPromise;
  });

  it("does not block on a different repo's staging lock", async () => {
    const ctx = buildTestCtx();
    ctx.reposRepo.add('other', 'repo');
    const app = createApp(ctx);

    let releaseHold;
    const held = new Promise((resolve) => { releaseHold = resolve; });
    const holdingPromise = ctx.lockManager.withLock('other/repo#refs/heads/staging', 'someone-else', 'corr-x', () => held);
    await new Promise((r) => setTimeout(r, 5));

    const res = await request(app)
      .post('/api/staging/reset')
      .set('Authorization', `Bearer ${config.API_TOKEN}`)
      .send(REPO);

    expect(res.status).toBe(200);

    releaseHold();
    await holdingPromise;
  });

  it('remergeInQa sequentially re-merges every In QA ticket in that repo and reports per-ticket outcomes', async () => {
    const ctx = buildTestCtx();
    ctx.ticketsRepo.upsert({ key: 'PROJ-1', jiraStatus: 'In QA', pipelineState: 'unmerged', repoOwner: REPO.owner, repoName: REPO.name });
    ctx.ticketsRepo.upsert({ key: 'PROJ-2', jiraStatus: 'In QA', pipelineState: 'unmerged', repoOwner: REPO.owner, repoName: REPO.name });
    // A ticket "In QA" in a different repo must not be swept up in this repo's remerge.
    ctx.reposRepo.add('other', 'repo');
    ctx.ticketsRepo.upsert({ key: 'PROJ-3', jiraStatus: 'In QA', pipelineState: 'unmerged', repoOwner: 'other', repoName: 'repo' });
    const app = createApp(ctx);

    const res = await request(app)
      .post('/api/staging/reset')
      .set('Authorization', `Bearer ${config.API_TOKEN}`)
      .send({ ...REPO, remergeInQa: true });

    expect(res.status).toBe(200);
    expect(res.body.remerge.requested).toBe(true);
    expect(res.body.remerge.results).toHaveLength(2);
    expect(res.body.remerge.results.every((r) => r.outcome === 'MERGED')).toBe(true);
    expect(ctx.github.createMerge).toHaveBeenCalledTimes(2);
  });
});
