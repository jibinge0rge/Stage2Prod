const { createBranchFromProduction, BranchNotReadyError } = require('../../src/services/createBranch');
const { createTestDb, seedTicket, noopLogger } = require('../setup');
const { OUTCOMES } = require('../../src/lib/constants');

function notFound() {
  const err = new Error('Not Found');
  err.status = 404;
  return err;
}

function baseDeps({ pipelineState = 'unmerged', summary = 'Harden OAuth token refresh', withRepo = true } = {}) {
  const { ticketsRepo, eventsRepo, reposRepo } = createTestDb();
  reposRepo.add('acme', 'widgets', { productionBranch: 'main', stagingBranch: 'qa', jiraProjectKey: 'PROJ' });
  seedTicket(ticketsRepo, {
    key: 'PROJ-1',
    summary,
    jiraStatus: 'In Development',
    pipelineState,
    ...(withRepo ? { repoOwner: 'acme', repoName: 'widgets' } : {}),
  });

  const github = {
    getRef: vi.fn(async (branch) => {
      if (branch === 'main') return 'prodsha1';
      throw notFound();
    }),
    createRef: vi.fn().mockResolvedValue({ sha: 'prodsha1' }),
  };
  const jira = { addComment: vi.fn().mockResolvedValue({ commented: true }), tryTransition: vi.fn().mockResolvedValue({ transitioned: true }) };
  const repoResolver = {
    matchByProjectKeyOnly: vi.fn(() => null),
    getClient: vi.fn(() => github),
  };

  return {
    ticketKey: 'PROJ-1',
    ticketsRepo,
    eventsRepo,
    reposRepo,
    repoResolver,
    jira,
    github,
    log: noopLogger,
    correlationId: 'corr-1',
  };
}

describe('createBranchFromProduction', () => {
  it('creates a branch from production and records it on the ticket', async () => {
    const deps = baseDeps();
    const result = await createBranchFromProduction(deps);

    expect(result).toMatchObject({ created: true, branch: 'feat/PROJ-1-harden-oauth-token-refresh', from: 'main' });
    expect(deps.github.createRef).toHaveBeenCalledWith('feat/PROJ-1-harden-oauth-token-refresh', 'prodsha1');
    expect(deps.jira.addComment).toHaveBeenCalledWith('PROJ-1', expect.stringContaining('main'));
    expect(deps.jira.tryTransition).toHaveBeenCalledWith('PROJ-1', 'In Progress');
    expect(deps.ticketsRepo.get('PROJ-1').jira_status).toBe('In Progress');
    expect(deps.ticketsRepo.get('PROJ-1').branch_name).toBe('feat/PROJ-1-harden-oauth-token-refresh');

    const { events } = deps.eventsRepo.list({ ticketKey: 'PROJ-1' });
    expect(events[0]).toMatchObject({
      action: 'create-branch',
      outcome: OUTCOMES.NOTED,
      title: 'Created branch from production',
    });
  });

  it('uses an explicit name when given', async () => {
    const deps = baseDeps();
    const result = await createBranchFromProduction({ ...deps, branchName: 'feat/PROJ-1-custom' });
    expect(result.branch).toBe('feat/PROJ-1-custom');
    expect(deps.github.createRef).toHaveBeenCalledWith('feat/PROJ-1-custom', 'prodsha1');
  });

  it('records an already-existing branch instead of overwriting it', async () => {
    const deps = baseDeps();
    deps.github.getRef = vi.fn(async (branch) => {
      if (branch === 'main') return 'prodsha1';
      if (branch === 'feat/PROJ-1-custom') return 'existingsha';
      throw notFound();
    });

    const result = await createBranchFromProduction({ ...deps, branchName: 'feat/PROJ-1-custom' });

    expect(result.created).toBe(false);
    expect(deps.github.createRef).not.toHaveBeenCalled();
    expect(deps.jira.addComment).not.toHaveBeenCalled();
    expect(deps.jira.tryTransition).not.toHaveBeenCalled();
    expect(deps.ticketsRepo.get('PROJ-1').branch_name).toBe('feat/PROJ-1-custom');
    expect(deps.ticketsRepo.get('PROJ-1').head_sha).toBe('existingsha');
  });

  it('throws BranchNotReadyError when production branch is missing', async () => {
    const deps = baseDeps();
    deps.github.getRef = vi.fn().mockRejectedValue(notFound());
    await expect(createBranchFromProduction(deps)).rejects.toBeInstanceOf(BranchNotReadyError);
    expect(deps.github.createRef).not.toHaveBeenCalled();
  });

  it('throws when the name collides with production or staging', async () => {
    const deps = baseDeps();
    deps.reposRepo.update('acme', 'widgets', { productionBranch: 'PROJ-1-prod', stagingBranch: 'PROJ-1-qa' });
    await expect(createBranchFromProduction({ ...deps, branchName: 'PROJ-1-prod' })).rejects.toBeInstanceOf(
      BranchNotReadyError
    );
    await expect(createBranchFromProduction({ ...deps, branchName: 'PROJ-1-qa' })).rejects.toBeInstanceOf(
      BranchNotReadyError
    );
    expect(deps.github.createRef).not.toHaveBeenCalled();
  });

  it('resolves via project key when the ticket has no repo yet', async () => {
    const deps = baseDeps({ withRepo: false });
    deps.repoResolver.matchByProjectKeyOnly = vi.fn(() => ({ owner: 'acme', name: 'widgets' }));

    const result = await createBranchFromProduction(deps);

    expect(result.created).toBe(true);
    expect(deps.ticketsRepo.get('PROJ-1').repo_owner).toBe('acme');
    expect(deps.repoResolver.matchByProjectKeyOnly).toHaveBeenCalledWith('PROJ-1');
  });

  it('throws when no repo can be resolved', async () => {
    const deps = baseDeps();
    deps.ticketsRepo.upsert({
      key: 'OTHER-1',
      summary: 'Something',
      jiraStatus: 'In Development',
      pipelineState: 'unmerged',
    });
    deps.reposRepo.add('acme', 'other', { jiraProjectKey: 'ELSE' });

    await expect(createBranchFromProduction({ ...deps, ticketKey: 'OTHER-1' })).rejects.toBeInstanceOf(
      BranchNotReadyError
    );
  });
});
