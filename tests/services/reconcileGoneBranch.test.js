const { reconcileGoneBranch } = require('../../src/services/reconcileGoneBranch');
const { createTestDb, seedTicket, noopLogger } = require('../setup');
const { PIPELINE_STATES, OUTCOMES } = require('../../src/lib/constants');

function notFound() {
  const err = new Error('Not Found');
  err.status = 404;
  return err;
}

function setup({ pipelineState = PIPELINE_STATES.UNMERGED, withPr = false } = {}) {
  const { ticketsRepo, eventsRepo, reposRepo } = createTestDb();
  reposRepo.add('acme', 'widgets', { productionBranch: 'main', stagingBranch: 'qa' });
  seedTicket(ticketsRepo, {
    key: 'PROJ-1',
    jiraStatus: 'In QA',
    pipelineState,
    repoOwner: 'acme',
    repoName: 'widgets',
  });
  ticketsRepo.setGithubFacts('PROJ-1', {
    branchName: 'feat/PROJ-1-thing',
    ...(withPr ? { prNumber: 18, prState: 'open' } : {}),
  });
  return { ticketsRepo, eventsRepo, reposRepo };
}

describe('reconcileGoneBranch', () => {
  it('clears the stale branch and moves Jira to To Do when Open is not in the workflow', async () => {
    const { ticketsRepo, eventsRepo, reposRepo } = setup();
    const github = { getRef: vi.fn().mockRejectedValue(notFound()) };
    const jira = {
      addComment: vi.fn().mockResolvedValue({ commented: true }),
      tryTransition: vi.fn().mockImplementation(async (_key, name) => {
        if (name === 'To Do') return { transitioned: true };
        return { transitioned: false, reason: 'transition-not-available' };
      }),
    };

    const reset = await reconcileGoneBranch({
      row: ticketsRepo.get('PROJ-1'),
      ticketsRepo,
      eventsRepo,
      reposRepo,
      repoResolver: { getClient: () => github },
      jira,
      log: noopLogger,
    });

    expect(reset).toBe(true);
    const row = ticketsRepo.get('PROJ-1');
    expect(row.branch_name).toBeNull();
    expect(row.pipeline_state).toBe(PIPELINE_STATES.UNMERGED);
    expect(row.jira_status).toBe('To Do');
    expect(jira.tryTransition).toHaveBeenCalledWith('PROJ-1', 'To Do');
    expect(jira.addComment).toHaveBeenCalledWith('PROJ-1', expect.stringContaining('feat/PROJ-1-thing'));
    const { events } = eventsRepo.list({ ticketKey: 'PROJ-1' });
    expect(events[0]).toMatchObject({
      outcome: OUTCOMES.RESET,
      title: 'Feature branch gone — reset to To Do',
    });
  });

  it('leaves the ticket alone when the branch still exists', async () => {
    const { ticketsRepo, eventsRepo, reposRepo } = setup();
    const github = { getRef: vi.fn().mockResolvedValue('abc123') };

    const reset = await reconcileGoneBranch({
      row: ticketsRepo.get('PROJ-1'),
      ticketsRepo,
      eventsRepo,
      reposRepo,
      repoResolver: { getClient: () => github },
      jira: { tryTransition: vi.fn() },
      log: noopLogger,
    });

    expect(reset).toBe(false);
    expect(ticketsRepo.get('PROJ-1').branch_name).toBe('feat/PROJ-1-thing');
  });

  it('does not reset a ticket already merged to production', async () => {
    const { ticketsRepo, eventsRepo, reposRepo } = setup({ pipelineState: PIPELINE_STATES.DEVELOP });
    const github = { getRef: vi.fn().mockRejectedValue(notFound()) };

    const reset = await reconcileGoneBranch({
      row: ticketsRepo.get('PROJ-1'),
      ticketsRepo,
      eventsRepo,
      reposRepo,
      repoResolver: { getClient: () => github },
      jira: { tryTransition: vi.fn() },
      log: noopLogger,
    });

    expect(reset).toBe(false);
    expect(github.getRef).not.toHaveBeenCalled();
    expect(ticketsRepo.get('PROJ-1').branch_name).toBe('feat/PROJ-1-thing');
  });

  it('does not reset while an open PR still exists', async () => {
    const { ticketsRepo, eventsRepo, reposRepo } = setup({
      pipelineState: PIPELINE_STATES.STAGING_QUEUED,
      withPr: true,
    });
    const github = {
      getRef: vi.fn().mockRejectedValue(notFound()),
      getPr: vi.fn().mockResolvedValue({ number: 18, state: 'open', merged: false }),
    };

    const reset = await reconcileGoneBranch({
      row: ticketsRepo.get('PROJ-1'),
      ticketsRepo,
      eventsRepo,
      reposRepo,
      repoResolver: { getClient: () => github },
      jira: { tryTransition: vi.fn() },
      log: noopLogger,
    });

    expect(reset).toBe(false);
    expect(ticketsRepo.get('PROJ-1').pr_number).toBe(18);
  });

  it('resets when both the branch and the PR are gone on GitHub', async () => {
    const { ticketsRepo, eventsRepo, reposRepo } = setup({
      pipelineState: PIPELINE_STATES.STAGING_QUEUED,
      withPr: true,
    });
    const github = {
      getRef: vi.fn().mockRejectedValue(notFound()),
      getPr: vi.fn().mockRejectedValue(notFound()),
    };
    const jira = {
      addComment: vi.fn().mockResolvedValue({ commented: true }),
      tryTransition: vi.fn().mockResolvedValue({ transitioned: true }),
    };

    const reset = await reconcileGoneBranch({
      row: ticketsRepo.get('PROJ-1'),
      ticketsRepo,
      eventsRepo,
      reposRepo,
      repoResolver: { getClient: () => github },
      jira,
      log: noopLogger,
    });

    expect(reset).toBe(true);
    expect(ticketsRepo.get('PROJ-1')).toMatchObject({
      branch_name: null,
      pr_number: null,
      pipeline_state: PIPELINE_STATES.UNMERGED,
      jira_status: 'Open',
    });
  });

  it('resets when the PR is closed unmerged and the branch is gone', async () => {
    const { ticketsRepo, eventsRepo, reposRepo } = setup({
      pipelineState: PIPELINE_STATES.STAGING_QUEUED,
      withPr: true,
    });
    const github = {
      getRef: vi.fn().mockRejectedValue(notFound()),
      getPr: vi.fn().mockResolvedValue({ number: 18, state: 'closed', merged: false }),
    };
    const jira = {
      addComment: vi.fn().mockResolvedValue({ commented: true }),
      tryTransition: vi.fn().mockResolvedValue({ transitioned: true }),
    };

    const reset = await reconcileGoneBranch({
      row: ticketsRepo.get('PROJ-1'),
      ticketsRepo,
      eventsRepo,
      reposRepo,
      repoResolver: { getClient: () => github },
      jira,
      log: noopLogger,
    });

    expect(reset).toBe(true);
    expect(ticketsRepo.get('PROJ-1').branch_name).toBeNull();
  });
});
