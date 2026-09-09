const request = require('supertest');
const { createApp } = require('../../src/app');
const { createTestDb, fakeDisplayGithub } = require('../setup');
const { config } = require('../../src/config');

function buildTestCtx({ getClient } = {}) {
  const { ticketsRepo, eventsRepo, cursorRepo, lockManager, reposRepo } = createTestDb();
  const poller = { isRunning: () => true, nextPollAt: null };
  const displayGithub = fakeDisplayGithub({ getClient });
  return { config, ticketsRepo, eventsRepo, cursorRepo, lockManager, reposRepo, poller, displayGithub };
}

function stubGithub(overrides = {}) {
  return {
    listOpenPulls: vi.fn().mockResolvedValue([]),
    listCommitsAhead: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

describe('GET /api/untracked', () => {
  it('returns PRs (split by base) and staging commits with no matching tracked ticket, per active repo', async () => {
    const github = stubGithub({
      listOpenPulls: vi.fn().mockResolvedValue([
        { number: 3, title: 'random cleanup', head: { ref: 'someones-experiment' }, base: { ref: 'staging' }, user: { login: 'bob' }, html_url: 'https://x/3', created_at: 't3' },
        { number: 4, title: 'straight to prod', head: { ref: 'hotfix' }, base: { ref: 'develop' }, user: { login: 'carol' }, html_url: 'https://x/4', created_at: 't4' },
      ]),
      listCommitsAhead: vi.fn().mockResolvedValue([
        { sha: 's1', commit: { message: 'PROJ-1 merge', author: { name: 'alice', date: 't1' } }, html_url: 'https://x/c1' },
        { sha: 's2', commit: { message: 'unplanned staging tweak', author: { name: 'bob', date: 't2' } }, html_url: 'https://x/c2' },
      ]),
    });
    const ctx = buildTestCtx({ getClient: () => github });
    ctx.reposRepo.add('acme', 'widgets');
    ctx.ticketsRepo.upsert({ key: 'PROJ-1', summary: 's', jiraStatus: 'In QA' });
    const app = createApp(ctx);

    const res = await request(app).get('/api/untracked');
    expect(res.status).toBe(200);
    expect(res.body.repos).toHaveLength(1);
    const [entry] = res.body.repos;
    expect(entry.repo).toEqual({ owner: 'acme', name: 'widgets', productionBranch: 'develop', stagingBranch: 'staging' });
    expect(entry.pullRequestsToStaging).toHaveLength(1);
    expect(entry.pullRequestsToStaging[0].number).toBe(3);
    expect(entry.pullRequestsToProduction).toHaveLength(1);
    expect(entry.pullRequestsToProduction[0].number).toBe(4);
    expect(entry.stagingCommits).toEqual([{ sha: 's2', message: 'unplanned staging tweak', author: 'bob', date: 't2', url: 'https://x/c2' }]);
  });

  it('filters to one repo via ?repo=owner/name', async () => {
    const githubA = stubGithub();
    const githubB = stubGithub();
    const ctx = buildTestCtx({ getClient: (owner, name) => (name === 'widgets' ? githubA : githubB) });
    ctx.reposRepo.add('acme', 'widgets');
    ctx.reposRepo.add('acme', 'gadgets');
    const app = createApp(ctx);

    const res = await request(app).get('/api/untracked').query({ repo: 'acme/gadgets' });
    expect(res.status).toBe(200);
    expect(res.body.repos).toHaveLength(1);
    expect(res.body.repos[0].repo.name).toBe('gadgets');
    expect(githubA.listOpenPulls).not.toHaveBeenCalled();
    expect(githubB.listOpenPulls).toHaveBeenCalled();
  });
});
