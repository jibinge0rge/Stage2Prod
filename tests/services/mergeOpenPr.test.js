const { mergeOpenPr, MergeNotReadyError } = require('../../src/services/mergeOpenPr');
const { createTestDb, seedTicket, noopLogger } = require('../setup');
const { PIPELINE_STATES } = require('../../src/lib/constants');

function baseDeps({ pipelineState, prNumber = 42, branchName = 'feat/PROJ-1-thing', prState = 'open', merged = false } = {}) {
  const { ticketsRepo, eventsRepo, lockManager } = createTestDb();
  seedTicket(ticketsRepo, { key: 'PROJ-1', jiraStatus: 'In QA', pipelineState });
  ticketsRepo.setGithubFacts('PROJ-1', { prNumber, branchName });

  // Base defaults to whichever branch matches the seeded pipelineState, so
  // most tests don't need to think about it; individual tests override it.
  const base = pipelineState === PIPELINE_STATES.QUEUED ? 'main' : 'qa';

  const github = {
    getPr: vi.fn().mockResolvedValue({ number: prNumber, state: prState, merged, base, head: branchName, mergeable: true, mergeableState: 'clean' }),
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

  it('determines the target from the PR\'s real base branch, not from pipeline_state — lets a retry from conflict work', async () => {
    // Ticket is stuck in CONFLICT, but its PR is (still) open into staging
    // and now mergeable (e.g. the user fixed it on GitHub) — a retry
    // should succeed and land it on staging, using the PR's base to know
    // that's the right target.
    const deps = baseDeps({ pipelineState: PIPELINE_STATES.CONFLICT, prNumber: 7, branchName: 'feat/PROJ-1-thing' });
    deps.github.getPr = vi.fn().mockResolvedValue({ number: 7, state: 'open', merged: false, base: 'qa', head: 'feat/PROJ-1-thing', mergeable: true });

    const result = await mergeOpenPr(deps);

    expect(result.outcome).toBe('MERGED');
    expect(result.target).toBe('staging');
    expect(deps.ticketsRepo.get('PROJ-1').pipeline_state).toBe(PIPELINE_STATES.STAGING);
  });

  it('marks CONFLICT and comments on Jira when GitHub refuses the merge (405) with a genuine conflict', async () => {
    const deps = baseDeps({ pipelineState: PIPELINE_STATES.STAGING_QUEUED });
    const err = new Error('Pull Request is not mergeable');
    err.status = 405;
    deps.github.mergePr = vi.fn().mockRejectedValue(err);

    await expect(mergeOpenPr(deps)).rejects.toMatchObject({ status: 409 });
    expect(deps.ticketsRepo.get('PROJ-1').pipeline_state).toBe(PIPELINE_STATES.CONFLICT);
    expect(deps.jira.addComment).toHaveBeenCalledWith('PROJ-1', expect.stringContaining('conflict'));
  });

  it('clears pipeline state to unmerged (not stuck in "conflict") when the PR no longer exists on GitHub, without ever attempting a merge', async () => {
    const deps = baseDeps({ pipelineState: PIPELINE_STATES.STAGING_QUEUED });
    const notFound = new Error('Not Found');
    notFound.status = 404;
    deps.github.getPr = vi.fn().mockRejectedValue(notFound);

    await expect(mergeOpenPr(deps)).rejects.toMatchObject({ status: 409, message: expect.stringContaining('no longer exists') });
    expect(deps.github.mergePr).not.toHaveBeenCalled();
    // Unmerged, not conflict — there's nothing left to retry, so the
    // ticket shouldn't be stuck showing a dead-end "Retry merge" button.
    const row = deps.ticketsRepo.get('PROJ-1');
    expect(row.pipeline_state).toBe(PIPELINE_STATES.UNMERGED);
    // The stale PR reference must go too, or the drawer keeps showing
    // "Pull request #N" and a frozen check status for a PR that's gone.
    expect(row.pr_number).toBeNull();
    expect(row.check_status).toBeNull();
    expect(deps.jira.addComment).toHaveBeenCalledWith('PROJ-1', expect.stringContaining('no longer exists'));
  });

  it('clears pipeline state to unmerged (not stuck in "conflict") when the PR was closed without merging, without attempting a merge', async () => {
    const deps = baseDeps({ pipelineState: PIPELINE_STATES.QUEUED, prState: 'closed', merged: false });

    await expect(mergeOpenPr(deps)).rejects.toMatchObject({ status: 409, message: expect.stringContaining('closed without merging') });
    expect(deps.github.mergePr).not.toHaveBeenCalled();
    const row = deps.ticketsRepo.get('PROJ-1');
    expect(row.pipeline_state).toBe(PIPELINE_STATES.UNMERGED);
    expect(row.pr_number).toBeNull();
  });

  it('reconciles instead of erroring when the PR was already merged outside Stage2Prod', async () => {
    const deps = baseDeps({ pipelineState: PIPELINE_STATES.STAGING_QUEUED, prState: 'closed', merged: true });

    const result = await mergeOpenPr(deps);

    expect(result).toMatchObject({ outcome: 'MERGED', target: 'staging', alreadyMerged: true });
    expect(deps.github.mergePr).not.toHaveBeenCalled();
    expect(deps.ticketsRepo.get('PROJ-1').pipeline_state).toBe(PIPELINE_STATES.STAGING);
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

  it('propagates an unrelated getPr error (e.g. 401) without treating it as "gone"', async () => {
    const deps = baseDeps({ pipelineState: PIPELINE_STATES.QUEUED });
    const err = new Error('Bad credentials');
    err.status = 401;
    deps.github.getPr = vi.fn().mockRejectedValue(err);

    await expect(mergeOpenPr(deps)).rejects.toThrow('Bad credentials');
    expect(deps.github.mergePr).not.toHaveBeenCalled();
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
