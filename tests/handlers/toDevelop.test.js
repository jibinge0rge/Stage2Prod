const { toDevelop } = require('../../src/handlers/toDevelop');
const { createTestDb, seedTicket, noopLogger } = require('../setup');
const { OUTCOMES, PIPELINE_STATES } = require('../../src/lib/constants');

function baseDeps(overrides = {}) {
  const { ticketsRepo, eventsRepo, lockManager } = createTestDb();
  seedTicket(ticketsRepo, { key: 'PROJ-1', jiraStatus: 'Approved' });

  const pr = { number: 42, head: { ref: 'feat/PROJ-1-thing', sha: 'headsha1' }, base: { ref: 'main' } };

  const github = {
    getCombinedStatus: vi.fn().mockResolvedValue({ overall: 'passing' }),
    createPr: vi.fn().mockResolvedValue({ number: 43, htmlUrl: 'https://x/43', headSha: 'newsha1' }),
  };
  const jira = {
    addComment: vi.fn().mockResolvedValue({ commented: true }),
  };
  const ticketMatcher = {
    findOpenPrForTicket: vi.fn().mockResolvedValue(pr),
    findBranchForTicket: vi.fn().mockResolvedValue('feat/PROJ-1-thing'),
  };

  return {
    event: { ticketKey: 'PROJ-1', newStatus: 'Approved' },
    log: noopLogger,
    correlationId: 'corr-1',
    repoOwner: 'acme',
    repoName: 'widgets',
    // Deliberately not the default 'develop' — proves the name is
    // actually threaded through rather than hardcoded anywhere.
    productionBranch: 'main',
    github,
    jira,
    ticketsRepo,
    eventsRepo,
    lockManager,
    ticketMatcher,
    pr,
    ...overrides,
  };
}

describe('toDevelop handler', () => {
  it('finds the already-open PR into production, stores its check status, but does not merge it', async () => {
    const deps = baseDeps();
    const result = await toDevelop(deps);

    expect(result.outcome).toBe(OUTCOMES.PR_OPENED);
    expect(deps.ticketMatcher.findOpenPrForTicket).toHaveBeenCalledWith('PROJ-1', { base: 'main' });
    expect(deps.github.createPr).not.toHaveBeenCalled();
    expect(deps.jira.addComment).toHaveBeenCalledWith('PROJ-1', expect.stringContaining('main'));
    const row = deps.ticketsRepo.get('PROJ-1');
    expect(row.pipeline_state).toBe(PIPELINE_STATES.QUEUED);
    expect(row.pr_number).toBe(42);
    expect(row.check_status).toBe('passing');
  });

  it('creates a PR from the matched feature branch when none already exists into production', async () => {
    const deps = baseDeps();
    deps.ticketMatcher.findOpenPrForTicket = vi.fn().mockResolvedValue(null);

    const result = await toDevelop(deps);

    expect(result.outcome).toBe(OUTCOMES.PR_OPENED);
    expect(deps.github.createPr).toHaveBeenCalledWith({
      base: 'main',
      head: 'feat/PROJ-1-thing',
      title: expect.any(String),
      body: expect.any(String),
    });
    expect(deps.ticketsRepo.get('PROJ-1').pr_number).toBe(43);
  });

  it('stores no check status when GitHub has zero checks', async () => {
    const deps = baseDeps();
    deps.github.getCombinedStatus = vi.fn().mockResolvedValue({ overall: null });
    await toDevelop(deps);
    expect(deps.ticketsRepo.get('PROJ-1').check_status).toBeNull();
  });

  it('still stores check status without gating on it — failing checks no longer block the PR being ensured', async () => {
    const deps = baseDeps();
    deps.github.getCombinedStatus = vi.fn().mockResolvedValue({ overall: 'failing' });

    const result = await toDevelop(deps);

    expect(result.outcome).toBe(OUTCOMES.PR_OPENED);
    expect(deps.ticketsRepo.get('PROJ-1').check_status).toBe('failing');
    expect(deps.ticketsRepo.get('PROJ-1').pipeline_state).toBe(PIPELINE_STATES.QUEUED);
  });

  it('records NOTED and takes no action when no open PR and no matching branch exist', async () => {
    const deps = baseDeps();
    deps.ticketMatcher.findOpenPrForTicket = vi.fn().mockResolvedValue(null);
    deps.ticketMatcher.findBranchForTicket = vi.fn().mockResolvedValue(null);

    const result = await toDevelop(deps);

    expect(result.outcome).toBe(OUTCOMES.NOTED);
    expect(deps.github.getCombinedStatus).not.toHaveBeenCalled();
    expect(deps.github.createPr).not.toHaveBeenCalled();
  });

  it('never calls mergePr or deleteRef — merging is a separate, human-triggered action', async () => {
    const deps = baseDeps();
    deps.github.mergePr = vi.fn();
    deps.github.deleteRef = vi.fn();
    await toDevelop(deps);
    expect(deps.github.mergePr).not.toHaveBeenCalled();
    expect(deps.github.deleteRef).not.toHaveBeenCalled();
  });
});
