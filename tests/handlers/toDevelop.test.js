const { toDevelop } = require('../../src/handlers/toDevelop');
const { createTestDb, seedTicket, noopLogger } = require('../setup');
const { OUTCOMES, PIPELINE_STATES } = require('../../src/lib/constants');

function baseDeps(overrides = {}) {
  const { ticketsRepo, eventsRepo, lockManager } = createTestDb();
  seedTicket(ticketsRepo, { key: 'PROJ-1', jiraStatus: 'Approved' });

  const pr = { number: 42, head: { ref: 'feat/PROJ-1-thing', sha: 'headsha1' }, base: { ref: 'main' } };

  const github = {
    getCombinedStatus: vi.fn().mockResolvedValue({ overall: 'passing' }),
    mergePr: vi.fn().mockResolvedValue({ merged: true, sha: 'mergedsha1' }),
    deleteRef: vi.fn().mockResolvedValue({ deleted: true }),
  };
  const jira = {
    addComment: vi.fn().mockResolvedValue({ commented: true }),
  };
  const ticketMatcher = {
    findOpenPrForTicket: vi.fn().mockResolvedValue(pr),
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
  it('merges the PR, deletes the branch, and comments success when checks pass', async () => {
    const deps = baseDeps();
    const result = await toDevelop(deps);

    expect(result.outcome).toBe(OUTCOMES.MERGED);
    expect(deps.ticketMatcher.findOpenPrForTicket).toHaveBeenCalledWith('PROJ-1', { base: 'main' });
    expect(deps.github.mergePr).toHaveBeenCalledWith(42, { mergeMethod: 'merge' });
    expect(deps.github.deleteRef).toHaveBeenCalledWith('feat/PROJ-1-thing');
    expect(deps.jira.addComment).toHaveBeenCalledWith('PROJ-1', expect.stringContaining('develop'));
    expect(deps.ticketsRepo.get('PROJ-1').pipeline_state).toBe(PIPELINE_STATES.DEVELOP);

    const { events } = deps.eventsRepo.list({ ticketKey: 'PROJ-1' });
    expect(events[0].repo).toEqual({ owner: 'acme', name: 'widgets' });
  });

  it('never calls mergePr with squash', async () => {
    const deps = baseDeps();
    await toDevelop(deps);
    expect(deps.github.mergePr.mock.calls[0][1].mergeMethod).toBe('merge');
  });

  it('holds the merge and takes no git action when checks are failing', async () => {
    const deps = baseDeps();
    deps.github.getCombinedStatus = vi.fn().mockResolvedValue({ overall: 'failing' });

    const result = await toDevelop(deps);

    expect(result.outcome).toBe(OUTCOMES.HELD);
    expect(deps.github.mergePr).not.toHaveBeenCalled();
    expect(deps.github.deleteRef).not.toHaveBeenCalled();
    expect(deps.jira.addComment).toHaveBeenCalled();
  });

  it('holds the merge when checks are still pending', async () => {
    const deps = baseDeps();
    deps.github.getCombinedStatus = vi.fn().mockResolvedValue({ overall: 'pending' });

    const result = await toDevelop(deps);
    expect(result.outcome).toBe(OUTCOMES.HELD);
    expect(deps.github.mergePr).not.toHaveBeenCalled();
  });

  it('records NOTED and takes no action when no open PR into develop is found', async () => {
    const deps = baseDeps();
    deps.ticketMatcher.findOpenPrForTicket = vi.fn().mockResolvedValue(null);

    const result = await toDevelop(deps);

    expect(result.outcome).toBe(OUTCOMES.NOTED);
    expect(deps.github.getCombinedStatus).not.toHaveBeenCalled();
    expect(deps.github.mergePr).not.toHaveBeenCalled();
  });

  it('propagates a merge failure from GitHub without deleting the branch (retry behaviour itself is covered in clients/github.test.js)', async () => {
    const deps = baseDeps();
    const err = new Error('server error');
    err.status = 503;
    deps.github.mergePr = vi.fn().mockRejectedValue(err);

    await expect(toDevelop(deps)).rejects.toThrow('server error');
    expect(deps.github.deleteRef).not.toHaveBeenCalled();
  });
});
