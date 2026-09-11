const { Poller } = require('../../src/poller');
const { createTestDb, noopLogger } = require('../setup');
const { config } = require('../../src/config');

function issue(key, statusName, updated = '2026-01-01T00:00:00.000Z') {
  return { key, fields: { summary: 'Task', status: { name: statusName }, assignee: null, updated } };
}

function buildPoller(db, { issues, repoResolver }) {
  const { ticketsRepo, eventsRepo, cursorRepo, lockManager, reposRepo } = db;
  const jira = { search: vi.fn().mockResolvedValue({ issues }), rateLimit: null };
  const poller = new Poller({ jira, repoResolver, reposRepo, config, ticketsRepo, eventsRepo, cursorRepo, lockManager, logger: noopLogger });
  return { poller, ticketsRepo, eventsRepo };
}

describe('Poller._tick eager repo tagging', () => {
  it('tags a newly-seen ticket with its unambiguous project-key repo even when its status has no mapped handler', async () => {
    const db = createTestDb();
    db.reposRepo.add('acme', 'widgets', { jiraProjectKey: 'SCRUM' });
    const repoResolver = {
      invalidateAll: vi.fn(),
      matchByProjectKeyOnly: vi.fn((key) => (key === 'SCRUM-1' ? { owner: 'acme', name: 'widgets' } : null)),
    };
    const { poller, ticketsRepo } = buildPoller(db, { issues: [issue('SCRUM-1', 'To Do')], repoResolver });

    await poller.pollNow();

    expect(repoResolver.matchByProjectKeyOnly).toHaveBeenCalledWith('SCRUM-1');
    const row = ticketsRepo.get('SCRUM-1');
    expect(row.repo_owner).toBe('acme');
    expect(row.repo_name).toBe('widgets');
  });

  it('does not overwrite an already-resolved repo on a later tick', async () => {
    const db = createTestDb();
    db.reposRepo.add('acme', 'widgets', { jiraProjectKey: 'SCRUM' });
    db.ticketsRepo.upsert({ key: 'SCRUM-1', summary: 'Task', jiraStatus: 'To Do', repoOwner: 'acme', repoName: 'other-already-set' });
    const repoResolver = { invalidateAll: vi.fn(), matchByProjectKeyOnly: vi.fn(() => ({ owner: 'acme', name: 'widgets' })) };
    const { poller, ticketsRepo } = buildPoller(db, { issues: [issue('SCRUM-1', 'To Do')], repoResolver });

    await poller.pollNow();

    expect(ticketsRepo.get('SCRUM-1').repo_name).toBe('other-already-set');
  });

  it('leaves the repo unset when the project key matches no watched repo or is ambiguous', async () => {
    const db = createTestDb();
    db.reposRepo.add('acme', 'widgets', { jiraProjectKey: 'SCRUM' });
    const repoResolver = { invalidateAll: vi.fn(), matchByProjectKeyOnly: vi.fn(() => null) };
    const { poller, ticketsRepo } = buildPoller(db, { issues: [issue('OTHER-1', 'To Do')], repoResolver });

    await poller.pollNow();

    expect(ticketsRepo.get('OTHER-1').repo_owner).toBeNull();
  });

  it('does not dispatch a handler/action for a status with no mapping, even once tagged with a repo', async () => {
    const db = createTestDb();
    db.reposRepo.add('acme', 'widgets', { jiraProjectKey: 'SCRUM' });
    const repoResolver = { invalidateAll: vi.fn(), matchByProjectKeyOnly: vi.fn(() => ({ owner: 'acme', name: 'widgets' })) };
    const { poller, ticketsRepo, eventsRepo } = buildPoller(db, { issues: [issue('SCRUM-1', 'To Do')], repoResolver });

    await poller.pollNow();

    expect(ticketsRepo.get('SCRUM-1').repo_owner).toBe('acme');
    const { events } = eventsRepo.list({ ticketKey: 'SCRUM-1' });
    expect(events).toHaveLength(0);
  });

  it('dispatches using a per-repo custom status map', async () => {
    const db = createTestDb();
    db.reposRepo.add('acme', 'widgets', {
      jiraProjectKey: 'SCRUM',
      stagingBranch: 'staging',
      statusHandlerMap: {
        open: { jiraStatus: 'To Do' },
        in_progress: { jiraStatus: 'Doing' },
        in_qa: { jiraStatus: 'Doing QA', match: ['Doing QA'] },
        ready_for_release: { jiraStatus: 'Ready for Release' },
        done: { jiraStatus: 'Done' },
      },
    });
    // Prior status so the poller sees a transition into the custom-mapped In QA name.
    db.ticketsRepo.upsert({
      key: 'SCRUM-1',
      summary: 'Task',
      jiraStatus: 'To Do',
      lastSeenStatus: 'To Do',
      pipelineState: 'unmerged',
      repoOwner: 'acme',
      repoName: 'widgets',
    });
    const createPr = vi.fn().mockResolvedValue({ number: 9, htmlUrl: 'https://x/9', headSha: 'abc' });
    const repoResolver = {
      invalidateAll: vi.fn(),
      matchByProjectKeyOnly: vi.fn(() => ({ owner: 'acme', name: 'widgets' })),
      resolveTicket: vi.fn().mockResolvedValue({ found: true, owner: 'acme', name: 'widgets' }),
      getClient: () => ({ createPr }),
      getMatcher: () => ({
        findBranchForTicket: vi.fn().mockResolvedValue('feat/SCRUM-1'),
        findOpenPrForTicket: vi.fn().mockResolvedValue(null),
      }),
    };
    const { ticketsRepo, eventsRepo, cursorRepo, lockManager, reposRepo } = db;
    const jira = {
      search: vi.fn().mockResolvedValue({ issues: [issue('SCRUM-1', 'Doing QA', '2026-01-01T01:00:00.000Z')] }),
      addComment: vi.fn().mockResolvedValue({ commented: true }),
      tryTransition: vi.fn().mockResolvedValue({ transitioned: true }),
      rateLimit: null,
    };
    const poller = new Poller({
      jira,
      repoResolver,
      reposRepo,
      config,
      ticketsRepo,
      eventsRepo,
      cursorRepo,
      lockManager,
      logger: noopLogger,
    });

    await poller.pollNow();

    expect(createPr).toHaveBeenCalled();
    expect(ticketsRepo.get('SCRUM-1').pipeline_state).toBe('staging_queued');
  });

  it('joins a second pollNow into the in-flight tick instead of searching twice', async () => {
    const db = createTestDb();
    let release;
    const searchStarted = new Promise((resolve) => {
      release = resolve;
    });
    const jira = {
      search: vi.fn().mockImplementation(async () => {
        await searchStarted;
        return { issues: [issue('SCRUM-1', 'To Do')] };
      }),
      rateLimit: null,
    };
    const repoResolver = { invalidateAll: vi.fn(), matchByProjectKeyOnly: vi.fn(() => null) };
    const { ticketsRepo, eventsRepo, cursorRepo, lockManager, reposRepo } = db;
    const poller = new Poller({
      jira,
      repoResolver,
      reposRepo,
      config,
      ticketsRepo,
      eventsRepo,
      cursorRepo,
      lockManager,
      logger: noopLogger,
    });

    const first = poller.pollNow();
    const second = poller.pollNow();
    release();
    await Promise.all([first, second]);

    expect(jira.search).toHaveBeenCalledTimes(1);
  });
});
