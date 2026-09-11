const { openTicketPr, PrNotReadyError } = require('../../src/services/openTicketPr');
const { createTestDb, seedTicket, noopLogger } = require('../setup');
const { PIPELINE_STATES } = require('../../src/lib/constants');

function baseDeps({ pipelineState = PIPELINE_STATES.UNMERGED, withBranch = true } = {}) {
  const { ticketsRepo, eventsRepo, reposRepo, lockManager } = createTestDb();
  reposRepo.add('acme', 'widgets', { productionBranch: 'main', stagingBranch: 'qa' });
  seedTicket(ticketsRepo, {
    key: 'PROJ-1',
    summary: 'Fix login',
    jiraStatus: 'In Development',
    pipelineState,
    repoOwner: 'acme',
    repoName: 'widgets',
  });
  if (withBranch) ticketsRepo.setGithubFacts('PROJ-1', { branchName: 'feat/PROJ-1-login' });

  const github = {
    createPr: vi.fn().mockResolvedValue({ number: 42, htmlUrl: 'https://x/42', headSha: 'headsha1' }),
    getCombinedStatus: vi.fn().mockResolvedValue({ overall: 'passing' }),
    compareCommits: vi.fn().mockResolvedValue({ aheadBy: 2, behindBy: 0 }),
  };
  const ticketMatcher = {
    findBranchForTicket: vi.fn().mockResolvedValue(withBranch ? 'feat/PROJ-1-login' : null),
    findOpenPrForTicket: vi.fn().mockResolvedValue(null),
  };
  const jira = { addComment: vi.fn().mockResolvedValue({ commented: true }), tryTransition: vi.fn().mockResolvedValue({ transitioned: true }) };

  return {
    ticketKey: 'PROJ-1',
    ticketsRepo,
    eventsRepo,
    reposRepo,
    repoResolver: {
      getClient: vi.fn(() => github),
      getMatcher: vi.fn(() => ticketMatcher),
    },
    jira,
    lockManager,
    log: noopLogger,
    correlationId: 'corr-1',
    github,
    ticketMatcher,
  };
}

describe('openTicketPr', () => {
  it('opens a PR into staging from the feature branch and does not merge it', async () => {
    const deps = baseDeps();
    const result = await openTicketPr({ ...deps, target: 'staging' });

    expect(result).toMatchObject({ outcome: 'PR_OPENED', target: 'staging' });
    expect(deps.github.createPr).toHaveBeenCalledWith({
      base: 'qa',
      head: 'feat/PROJ-1-login',
      title: expect.any(String),
      body: expect.any(String),
    });
    expect(deps.ticketsRepo.get('PROJ-1').pipeline_state).toBe(PIPELINE_STATES.STAGING_QUEUED);
    expect(deps.ticketsRepo.get('PROJ-1').pr_number).toBe(42);
    expect(deps.jira.tryTransition).toHaveBeenCalledWith('PROJ-1', 'In QA');
  });

  it('opens a PR into production from the feature branch and does not merge it', async () => {
    const deps = baseDeps({ pipelineState: PIPELINE_STATES.STAGING });
    const result = await openTicketPr({ ...deps, target: 'production' });

    expect(result.target).toBe('production');
    expect(deps.github.createPr).toHaveBeenCalledWith({
      base: 'main',
      head: 'feat/PROJ-1-login',
      title: expect.any(String),
      body: expect.any(String),
    });
    expect(deps.ticketsRepo.get('PROJ-1').pipeline_state).toBe(PIPELINE_STATES.QUEUED);
    expect(deps.jira.tryTransition).toHaveBeenCalledWith('PROJ-1', 'Ready for Release');
  });

  it('reuses an already-open staging PR instead of creating a duplicate', async () => {
    const deps = baseDeps();
    deps.ticketMatcher.findOpenPrForTicket = vi.fn().mockResolvedValue({
      number: 7,
      head: { ref: 'feat/PROJ-1-login' },
    });

    await openTicketPr({ ...deps, target: 'staging' });

    expect(deps.github.createPr).not.toHaveBeenCalled();
    expect(deps.ticketsRepo.get('PROJ-1').pr_number).toBe(7);
    expect(deps.jira.tryTransition).toHaveBeenCalledWith('PROJ-1', 'In QA');
  });

  it('throws PrNotReadyError when no matching branch exists', async () => {
    const deps = baseDeps({ withBranch: false });
    await expect(openTicketPr({ ...deps, target: 'staging' })).rejects.toBeInstanceOf(PrNotReadyError);
    expect(deps.github.createPr).not.toHaveBeenCalled();
  });

  it('throws PrNotReadyError when the branch has no commits ahead of staging', async () => {
    const deps = baseDeps();
    deps.github.compareCommits = vi.fn().mockResolvedValue({ aheadBy: 0, behindBy: 0 });
    await expect(openTicketPr({ ...deps, target: 'staging' })).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining('No commits'),
    });
    expect(deps.github.createPr).not.toHaveBeenCalled();
  });

  it('throws PrNotReadyError when the branch has no commits ahead of production', async () => {
    const deps = baseDeps({ pipelineState: PIPELINE_STATES.STAGING });
    deps.github.compareCommits = vi.fn().mockResolvedValue({ aheadBy: 0, behindBy: 0 });
    await expect(openTicketPr({ ...deps, target: 'production' })).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining('No commits'),
    });
    expect(deps.github.createPr).not.toHaveBeenCalled();
  });

  it('throws when target is not staging or production', async () => {
    const deps = baseDeps();
    await expect(openTicketPr({ ...deps, target: 'elsewhere' })).rejects.toBeInstanceOf(PrNotReadyError);
  });
});
