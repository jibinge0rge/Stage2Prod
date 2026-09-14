const {
  createProductionCut,
  changelogFromStaging,
  CutNotReadyError,
  ticketsFromCommits,
  defaultCutBranchName,
} = require('../../src/services/productionCut');
const { createTestDb, seedTicket, noopLogger } = require('../setup');
const { OUTCOMES } = require('../../src/lib/constants');

function notFound() {
  const err = new Error('Not Found');
  err.status = 404;
  return err;
}

function baseDeps() {
  const { ticketsRepo, eventsRepo, reposRepo, cutsRepo, lockManager } = createTestDb();
  reposRepo.add('acme', 'widgets', { productionBranch: 'main', stagingBranch: 'qa' });
  seedTicket(ticketsRepo, {
    key: 'PROJ-1',
    summary: 'Login',
    jiraStatus: 'In QA',
    pipelineState: 'staging',
    repoOwner: 'acme',
    repoName: 'widgets',
    branchName: 'feat/PROJ-1-login',
  });

  const github = {
    getRef: vi.fn(async (branch) => {
      if (branch === 'qa') return 'stagingsha';
      if (branch === 'main') return 'prodsha';
      throw notFound();
    }),
    listCommitsAhead: vi.fn().mockResolvedValue([
      {
        sha: 'c1',
        commit: { message: 'Merge pull request #12 from acme/feat/PROJ-1-login' },
        html_url: 'https://x/c1',
      },
    ]),
    createRef: vi.fn().mockResolvedValue({ sha: 'stagingsha' }),
  };

  return {
    owner: 'acme',
    name: 'widgets',
    ticketsRepo,
    eventsRepo,
    reposRepo,
    cutsRepo,
    lockManager,
    repoResolver: { getClient: vi.fn(() => github) },
    github,
    log: noopLogger,
    correlationId: 'corr-1',
  };
}

describe('ticketsFromCommits', () => {
  it('picks up ticket keys from merge commit messages', () => {
    const { ticketsRepo } = createTestDb();
    seedTicket(ticketsRepo, {
      key: 'PROJ-1',
      summary: 'Login',
      jiraStatus: 'In QA',
      pipelineState: 'staging',
      repoOwner: 'acme',
      repoName: 'widgets',
    });
    const tickets = ticketsFromCommits(
      [{ commit: { message: 'Merge pull request #12 from acme/feat/PROJ-1-login' } }],
      { ticketsRepo, owner: 'acme', name: 'widgets' }
    );
    expect(tickets).toEqual([expect.objectContaining({ key: 'PROJ-1', summary: 'Login' })]);
  });
});

describe('changelogFromStaging', () => {
  it('falls back to tickets on staging when there is no previous release cut', async () => {
    const deps = baseDeps();
    const preview = await changelogFromStaging(deps);
    expect(preview.previousFrom).toBeNull();
    expect(preview.tickets.map((t) => t.key)).toEqual(['PROJ-1']);
    expect(deps.github.listCommitsAhead).not.toHaveBeenCalled();
  });

  it('compares staging to the latest release cut when one exists', async () => {
    const deps = baseDeps();
    deps.cutsRepo.insert({
      repoOwner: 'acme',
      repoName: 'widgets',
      branchName: 'release-4.3.0-v1',
      sha: 'oldsha',
      stagingSha: 'oldsha',
    });
    await changelogFromStaging(deps);
    expect(deps.github.listCommitsAhead).toHaveBeenCalledWith('oldsha', 'qa');
  });

  it('ignores a stored cut whose name does not include release', async () => {
    const deps = baseDeps();
    deps.cutsRepo.insert({
      repoOwner: 'acme',
      repoName: 'widgets',
      branchName: 'prod-old',
      sha: 'oldsha',
      stagingSha: 'oldsha',
    });
    const preview = await changelogFromStaging(deps);
    expect(preview.previousFrom).toBeNull();
  });
});

describe('createProductionCut', () => {
  it('creates a branch from staging and records tickets', async () => {
    const deps = baseDeps();
    const cut = await createProductionCut({ ...deps, branchName: 'release-4.3.0-v1' });

    expect(cut).toMatchObject({ branchName: 'release-4.3.0-v1', sha: 'stagingsha' });
    expect(cut.tickets.map((t) => t.key)).toEqual(['PROJ-1']);
    expect(deps.github.createRef).toHaveBeenCalledWith('release-4.3.0-v1', 'stagingsha');
    expect(deps.cutsRepo.list('acme', 'widgets')).toHaveLength(1);

    const { events } = deps.eventsRepo.list({ repo: 'acme/widgets' });
    expect(events[0]).toMatchObject({
      action: 'create-cut',
      outcome: OUTCOMES.NOTED,
      title: 'Cut release-4.3.0-v1 from staging',
    });
  });

  it('defaults to a dated release-* name', async () => {
    const deps = baseDeps();
    const cut = await createProductionCut(deps);
    expect(cut.branchName).toBe(defaultCutBranchName());
  });

  it('rejects a name that collides with staging', async () => {
    const deps = baseDeps();
    await expect(createProductionCut({ ...deps, branchName: 'qa' })).rejects.toBeInstanceOf(CutNotReadyError);
    expect(deps.github.createRef).not.toHaveBeenCalled();
  });

  it('rejects a name that does not include release', async () => {
    const deps = baseDeps();
    await expect(createProductionCut({ ...deps, branchName: 'prod-x' })).rejects.toBeInstanceOf(CutNotReadyError);
    expect(deps.github.createRef).not.toHaveBeenCalled();
  });

  it('rejects when staging is missing', async () => {
    const deps = baseDeps();
    deps.github.getRef = vi.fn().mockRejectedValue(notFound());
    await expect(createProductionCut({ ...deps, branchName: 'release-x' })).rejects.toBeInstanceOf(CutNotReadyError);
  });
});

describe('syncReleaseCutsFromGithub', () => {
  it('records GitHub branches whose names include release, newest first', async () => {
    const { syncReleaseCutsFromGithub } = require('../../src/services/productionCut');
    const deps = baseDeps();
    deps.github.listBranches = vi.fn().mockResolvedValue([
      { name: 'develop', commit: { sha: 's' } },
      { name: 'release-4.2.0', commit: { sha: 'old' } },
      { name: 'release-4.3.0-v1', commit: { sha: 'new' } },
      { name: 'feat/PROJ-1', commit: { sha: 'f' } },
    ]);
    deps.github.listCommitsAhead = vi.fn().mockResolvedValue([
      { sha: 'c1', commit: { message: 'Merge pull request #12 from acme/feat/PROJ-1-login' } },
    ]);

    const cuts = await syncReleaseCutsFromGithub({
      github: deps.github,
      cutsRepo: deps.cutsRepo,
      ticketsRepo: deps.ticketsRepo,
      owner: 'acme',
      name: 'widgets',
      stagingBranch: 'qa',
    });

    expect(cuts.map((c) => c.branchName)).toEqual(['release-4.3.0-v1', 'release-4.2.0']);
    expect(cuts[0].isLatest).toBe(true);
    expect(cuts[0].ticketCount).toBe(1);
  });
});
