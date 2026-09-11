const { reclassifyRepoTickets } = require('../../src/services/reclassifyRepoTickets');
const { createTestDb, seedTicket, noopLogger, fakeRepoResolver } = require('../setup');
const { PIPELINE_STATES } = require('../../src/lib/constants');

function baseSetup({
  productionBranch = 'prod',
  stagingBranch = 'develop',
  pipelineState = PIPELINE_STATES.QUEUED,
  prBase = 'release-4.3.0-v1',
} = {}) {
  const { ticketsRepo, eventsRepo, reposRepo } = createTestDb();
  reposRepo.add('acme', 'widgets', { productionBranch, stagingBranch, jiraProjectKey: 'VIM' });
  seedTicket(ticketsRepo, {
    key: 'VIM-115',
    jiraStatus: 'In Progress',
    pipelineState,
    repoOwner: 'acme',
    repoName: 'widgets',
    branchName: 'VIM-115',
    prNumber: 175,
    prState: 'open',
  });

  const github = {
    getPr: vi.fn().mockResolvedValue({
      number: 175,
      state: 'open',
      merged: false,
      base: prBase,
      head: 'VIM-115',
      headSha: 'abc123',
    }),
  };
  const repoResolver = fakeRepoResolver({ getClient: () => github });

  return {
    owner: 'acme',
    name: 'widgets',
    repoConfig: reposRepo.get('acme', 'widgets'),
    ticketsRepo,
    eventsRepo,
    repoResolver,
    github,
    log: noopLogger,
    correlationId: 'corr-1',
  };
}

describe('reclassifyRepoTickets', () => {
  it('detaches a PR whose base matches neither new staging nor production', async () => {
    // Real incident shape: PR still targets release-4.3.0-v1, but the repo
    // was remapped to production=prod / staging=develop.
    const deps = baseSetup({
      productionBranch: 'prod',
      stagingBranch: 'develop',
      pipelineState: PIPELINE_STATES.QUEUED,
      prBase: 'release-4.3.0-v1',
    });

    const changes = await reclassifyRepoTickets(deps);

    expect(changes).toEqual([
      expect.objectContaining({
        ticketKey: 'VIM-115',
        previousState: PIPELINE_STATES.QUEUED,
        nextState: PIPELINE_STATES.UNMERGED,
        detached: true,
        prBase: 'release-4.3.0-v1',
      }),
    ]);
    const row = deps.ticketsRepo.get('VIM-115');
    expect(row.pipeline_state).toBe(PIPELINE_STATES.UNMERGED);
    expect(row.pr_number).toBeNull();
    expect(row.branch_name).toBe('VIM-115');
    expect(deps.eventsRepo.timelineForTicket('VIM-115')[0].title).toBe('Detached PR after branch remap');
  });

  it('flips staging_queued → queued when the old staging branch is now production', async () => {
    const deps = baseSetup({
      productionBranch: 'release-4.3.0-v1',
      stagingBranch: 'develop',
      pipelineState: PIPELINE_STATES.STAGING_QUEUED,
      prBase: 'release-4.3.0-v1',
    });

    const changes = await reclassifyRepoTickets(deps);

    expect(changes).toEqual([
      expect.objectContaining({
        ticketKey: 'VIM-115',
        previousState: PIPELINE_STATES.STAGING_QUEUED,
        nextState: PIPELINE_STATES.QUEUED,
        detached: false,
      }),
    ]);
    expect(deps.ticketsRepo.get('VIM-115').pipeline_state).toBe(PIPELINE_STATES.QUEUED);
    expect(deps.ticketsRepo.get('VIM-115').pr_number).toBe(175);
  });

  it('flips queued → staging_queued when the PR base is the new staging branch', async () => {
    const deps = baseSetup({
      productionBranch: 'prod',
      stagingBranch: 'develop',
      pipelineState: PIPELINE_STATES.QUEUED,
      prBase: 'develop',
    });

    const changes = await reclassifyRepoTickets(deps);

    expect(changes[0]).toMatchObject({
      previousState: PIPELINE_STATES.QUEUED,
      nextState: PIPELINE_STATES.STAGING_QUEUED,
      detached: false,
    });
    expect(deps.ticketsRepo.get('VIM-115').pipeline_state).toBe(PIPELINE_STATES.STAGING_QUEUED);
  });

  it('no-ops when the PR base already matches the current pipeline role', async () => {
    const deps = baseSetup({
      productionBranch: 'prod',
      stagingBranch: 'develop',
      pipelineState: PIPELINE_STATES.QUEUED,
      prBase: 'prod',
    });

    const changes = await reclassifyRepoTickets(deps);
    expect(changes).toEqual([]);
    expect(deps.ticketsRepo.get('VIM-115').pipeline_state).toBe(PIPELINE_STATES.QUEUED);
  });

  it('clears a linked PR that 404s on GitHub', async () => {
    const deps = baseSetup();
    deps.github.getPr.mockRejectedValue(Object.assign(new Error('gone'), { status: 404 }));

    const changes = await reclassifyRepoTickets(deps);
    expect(changes[0]).toMatchObject({ detached: true, nextState: PIPELINE_STATES.UNMERGED });
    expect(deps.ticketsRepo.get('VIM-115').pr_number).toBeNull();
  });
});
