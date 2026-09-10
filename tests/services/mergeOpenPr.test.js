const { mergeOpenPr, MergeNotReadyError } = require('../../src/services/mergeOpenPr');
const { createTestDb, seedTicket, noopLogger } = require('../setup');
const { PIPELINE_STATES } = require('../../src/lib/constants');

function baseDeps({ pipelineState, prNumber = 42, branchName = 'feat/PROJ-1-thing' } = {}) {
  const { ticketsRepo, eventsRepo, lockManager } = createTestDb();
  seedTicket(ticketsRepo, { key: 'PROJ-1', jiraStatus: 'In QA', pipelineState });
  ticketsRepo.setGithubFacts('PROJ-1', { prNumber, branchName });

  const github = {
    mergePr: vi.fn().mockResolvedValue({ merged: true, sha: 'mergedsha1' }),
    deleteRef: vi.fn().mockResolvedValue({ deleted: true }),
  };
  const jira = { addComment: vi.fn().mockResolvedValue({ commented: true }) };

  return {
    ticketKey: 'PROJ-1',
    repoOwner: 'acme',
    repoName: 'widgets',
    productionBranch: 'main',
    stagingBranch: 'qa',
    github,
    jira,
    ticketsRepo,
    eventsRepo,
    lockManager,
    log: noopLogger,
    correlationId: 'corr-1',
  };
}

describe('mergeOpenPr', () => {
  it('merges a staging_queued ticket into staging, does not delete the branch', async () => {
    const deps = baseDeps({ pipelineState: PIPELINE_STATES.STAGING_QUEUED });
    const result = await mergeOpenPr(deps);

    expect(result.outcome).toBe('MERGED');
    expect(result.target).toBe('staging');
    expect(deps.github.mergePr).toHaveBeenCalledWith(42, { mergeMethod: 'merge' });
    expect(deps.github.deleteRef).not.toHaveBeenCalled();
    expect(deps.ticketsRepo.get('PROJ-1').pipeline_state).toBe(PIPELINE_STATES.STAGING);
    expect(deps.jira.addComment).toHaveBeenCalledWith('PROJ-1', expect.stringContaining('staging'));
  });

  it('merges a queued ticket into develop and deletes the branch', async () => {
    const deps = baseDeps({ pipelineState: PIPELINE_STATES.QUEUED });
    const result = await mergeOpenPr(deps);

    expect(result.outcome).toBe('MERGED');
    expect(result.target).toBe('develop');
    expect(deps.github.mergePr).toHaveBeenCalledWith(42, { mergeMethod: 'merge' });
    expect(deps.github.deleteRef).toHaveBeenCalledWith('feat/PROJ-1-thing');
    expect(deps.ticketsRepo.get('PROJ-1').pipeline_state).toBe(PIPELINE_STATES.DEVELOP);
    expect(deps.jira.addComment).toHaveBeenCalledWith('PROJ-1', expect.stringContaining('develop'));
  });

  it('never calls mergePr with squash', async () => {
    const deps = baseDeps({ pipelineState: PIPELINE_STATES.QUEUED });
    await mergeOpenPr(deps);
    expect(deps.github.mergePr.mock.calls[0][1].mergeMethod).toBe('merge');
  });

  it('rejects with MergeNotReadyError when the ticket has nothing awaiting merge', async () => {
    const deps = baseDeps({ pipelineState: PIPELINE_STATES.UNMERGED });
    await expect(mergeOpenPr(deps)).rejects.toThrow(MergeNotReadyError);
    expect(deps.github.mergePr).not.toHaveBeenCalled();
  });

  it('throws 404 when the ticket does not exist', async () => {
    const deps = baseDeps({ pipelineState: PIPELINE_STATES.QUEUED });
    deps.ticketKey = 'NOPE-1';
    await expect(mergeOpenPr(deps)).rejects.toMatchObject({ status: 404 });
  });

  it('marks CONFLICT and comments on Jira when GitHub reports the PR is not mergeable (405)', async () => {
    const deps = baseDeps({ pipelineState: PIPELINE_STATES.STAGING_QUEUED });
    const err = new Error('Pull Request is not mergeable');
    err.status = 405;
    deps.github.mergePr = vi.fn().mockRejectedValue(err);

    await expect(mergeOpenPr(deps)).rejects.toMatchObject({ status: 409 });
    expect(deps.ticketsRepo.get('PROJ-1').pipeline_state).toBe(PIPELINE_STATES.CONFLICT);
    expect(deps.jira.addComment).toHaveBeenCalledWith('PROJ-1', expect.stringContaining('conflict'));
  });

  it('propagates an unrelated GitHub error (e.g. 503) without marking conflict', async () => {
    const deps = baseDeps({ pipelineState: PIPELINE_STATES.QUEUED });
    const err = new Error('server error');
    err.status = 503;
    deps.github.mergePr = vi.fn().mockRejectedValue(err);

    await expect(mergeOpenPr(deps)).rejects.toThrow('server error');
    expect(deps.ticketsRepo.get('PROJ-1').pipeline_state).toBe(PIPELINE_STATES.QUEUED);
    expect(deps.github.deleteRef).not.toHaveBeenCalled();
  });

  it('serializes two concurrent merges targeting the same repo+branch via the ref lock', async () => {
    const deps = baseDeps({ pipelineState: PIPELINE_STATES.QUEUED });
    const order = [];
    deps.github.mergePr = vi.fn().mockImplementation(async () => {
      order.push('merge-start');
      await new Promise((r) => setTimeout(r, 20));
      order.push('merge-end');
      return { merged: true, sha: 'sha1' };
    });

    // Second call would 400 (already DEVELOP) after the first succeeds —
    // what matters here is that they don't run concurrently. Use two
    // separate tickets on the same production branch/lock key instead.
    seedTicket(deps.ticketsRepo, { key: 'PROJ-2', jiraStatus: 'Approved', pipelineState: PIPELINE_STATES.QUEUED });
    deps.ticketsRepo.setGithubFacts('PROJ-2', { prNumber: 99, branchName: 'feat/PROJ-2-thing' });

    await Promise.all([
      mergeOpenPr(deps),
      mergeOpenPr({ ...deps, ticketKey: 'PROJ-2' }),
    ]);

    expect(order).toEqual(['merge-start', 'merge-end', 'merge-start', 'merge-end']);
  });
});
