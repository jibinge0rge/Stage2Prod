const request = require('supertest');
const { createApp } = require('../../src/app');
const { createTestDb } = require('../setup');
const { config } = require('../../src/config');

function buildTestCtx() {
  const { ticketsRepo, eventsRepo, cursorRepo, lockManager, reposRepo } = createTestDb();
  const poller = { isRunning: () => true, nextPollAt: null };
  return { config, ticketsRepo, eventsRepo, cursorRepo, lockManager, reposRepo, poller };
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
  });

  it('404s for an unknown ticket key', async () => {
    const ctx = buildTestCtx();
    const app = createApp(ctx);
    const res = await request(app).get('/api/tickets/NOPE-1');
    expect(res.status).toBe(404);
  });
});
