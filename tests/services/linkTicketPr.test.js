const { linkTicketPr, listLinkablePulls, LinkNotReadyError } = require('../../src/services/linkTicketPr');
const { createTestDb, seedTicket, noopLogger } = require('../setup');
const { PIPELINE_STATES } = require('../../src/lib/constants');

function baseDeps() {
  const { ticketsRepo, eventsRepo, reposRepo } = createTestDb();
  reposRepo.add('acme', 'widgets', { productionBranch: 'main', stagingBranch: 'qa' });
  seedTicket(ticketsRepo, {
    key: 'PROJ-1',
    jiraStatus: 'In Progress',
    pipelineState: PIPELINE_STATES.UNMERGED,
    repoOwner: 'acme',
    repoName: 'widgets',
  });

  const github = {
    getPr: vi.fn().mockResolvedValue({
      number: 18,
      state: 'open',
      merged: false,
      base: 'qa',
      head: 'hotfix-login',
      headSha: 'abc123',
    }),
    getCombinedStatus: vi.fn().mockResolvedValue({ overall: null }),
    listOpenPulls: vi.fn().mockResolvedValue([
      {
        number: 18,
        title: 'fix login',
        head: { ref: 'hotfix-login' },
        base: { ref: 'qa' },
        html_url: 'https://x/18',
      },
      {
        number: 19,
        title: 'docs',
        head: { ref: 'docs' },
        base: { ref: 'some-other-branch' },
        html_url: 'https://x/19',
      },
    ]),
  };
  const jira = { addComment: vi.fn().mockResolvedValue({ commented: true }) };
  const repoResolver = { getClient: vi.fn(() => github) };

  return {
    ticketKey: 'PROJ-1',
    prNumber: 18,
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

describe('linkTicketPr', () => {
  it('attaches an open staging PR and queues it for merge', async () => {
    const deps = baseDeps();
    const result = await linkTicketPr(deps);

    expect(result).toEqual({ linked: true, prNumber: 18, pipelineState: PIPELINE_STATES.STAGING_QUEUED, target: 'staging' });
    const row = deps.ticketsRepo.get('PROJ-1');
    expect(row.branch_name).toBe('hotfix-login');
    expect(row.pr_number).toBe(18);
    expect(row.pr_state).toBe('open');
    expect(row.pipeline_state).toBe(PIPELINE_STATES.STAGING_QUEUED);
    expect(deps.jira.addComment).toHaveBeenCalledWith('PROJ-1', expect.stringContaining('#18'));
    expect(deps.eventsRepo.timelineForTicket('PROJ-1')[0].title).toBe('Linked existing PR');
  });

  it('attaches an open production PR as awaiting production', async () => {
    const deps = baseDeps();
    deps.github.getPr.mockResolvedValue({
      number: 18,
      state: 'open',
      merged: false,
      base: 'main',
      head: 'hotfix-login',
      headSha: 'abc123',
    });
    const result = await linkTicketPr(deps);
    expect(result.pipelineState).toBe(PIPELINE_STATES.QUEUED);
    expect(result.target).toBe('production');
  });

  it('records a merged staging PR as already on staging', async () => {
    const deps = baseDeps();
    deps.github.getPr.mockResolvedValue({
      number: 18,
      state: 'closed',
      merged: true,
      base: 'qa',
      head: 'hotfix-login',
      headSha: 'abc123',
    });
    const result = await linkTicketPr(deps);
    expect(result.pipelineState).toBe(PIPELINE_STATES.STAGING);
    expect(deps.ticketsRepo.get('PROJ-1').pr_state).toBe('merged');
  });

  it('rejects a closed unmerged PR or one aimed at the wrong branch', async () => {
    const deps = baseDeps();
    deps.github.getPr.mockResolvedValue({
      number: 18,
      state: 'closed',
      merged: false,
      base: 'qa',
      head: 'hotfix-login',
    });
    await expect(linkTicketPr(deps)).rejects.toBeInstanceOf(LinkNotReadyError);

    deps.github.getPr.mockResolvedValue({
      number: 18,
      state: 'open',
      merged: false,
      base: 'random',
      head: 'hotfix-login',
    });
    await expect(linkTicketPr(deps)).rejects.toThrow(/qa|main/);
  });

  it('rejects when another ticket already owns that PR', async () => {
    const deps = baseDeps();
    seedTicket(deps.ticketsRepo, {
      key: 'PROJ-2',
      jiraStatus: 'In QA',
      pipelineState: PIPELINE_STATES.STAGING_QUEUED,
      repoOwner: 'acme',
      repoName: 'widgets',
    });
    deps.ticketsRepo.setGithubFacts('PROJ-2', { prNumber: 18 });
    await expect(linkTicketPr(deps)).rejects.toThrow(/PROJ-2/);
  });

  it('404s when GitHub has no such PR', async () => {
    const deps = baseDeps();
    deps.github.getPr.mockRejectedValue(Object.assign(new Error('Not Found'), { status: 404 }));
    await expect(linkTicketPr(deps)).rejects.toMatchObject({ status: 404 });
  });
});

describe('listLinkablePulls', () => {
  it('returns open PRs into staging or production and skips other bases', async () => {
    const deps = baseDeps();
    const { pulls } = await listLinkablePulls(deps);
    expect(pulls.map((p) => p.number)).toEqual([18]);
    expect(pulls[0]).toMatchObject({
      title: 'fix login',
      headRef: 'hotfix-login',
      baseRef: 'qa',
      target: 'staging',
      repo: { owner: 'acme', name: 'widgets' },
    });
  });
});
