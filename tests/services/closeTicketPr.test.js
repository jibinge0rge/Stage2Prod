const { closeTicketPr, CloseNotReadyError } = require('../../src/services/closeTicketPr');
const { createTestDb, seedTicket, noopLogger } = require('../setup');
const { PIPELINE_STATES } = require('../../src/lib/constants');

function baseDeps({ pipelineState, prNumber = 42, branchName = 'feat/PROJ-1-thing', prState = 'open', merged = false } = {}) {
  const { ticketsRepo, eventsRepo, lockManager } = createTestDb();
  seedTicket(ticketsRepo, { key: 'PROJ-1', jiraStatus: 'In Progress', pipelineState });
  ticketsRepo.setGithubFacts('PROJ-1', { prNumber, branchName });

  const base = pipelineState === PIPELINE_STATES.QUEUED ? 'main' : 'qa';

  const github = {
    getPr: vi.fn().mockResolvedValue({
      number: prNumber,
      state: prState,
      merged,
      base,
      head: branchName,
      mergeable: true,
      mergeableState: 'clean',
    }),
    closePr: vi.fn().mockResolvedValue({ number: prNumber, state: 'closed' }),
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

describe('closeTicketPr', () => {
  it('closes a staging PR, keeps the branch, and returns the ticket to unmerged', async () => {
    const deps = baseDeps({ pipelineState: PIPELINE_STATES.STAGING_QUEUED });
    const result = await closeTicketPr(deps);

    expect(result).toMatchObject({ outcome: 'NOTED', target: 'staging' });
    expect(deps.github.closePr).toHaveBeenCalledWith(42);
    const row = deps.ticketsRepo.get('PROJ-1');
    expect(row.pipeline_state).toBe(PIPELINE_STATES.UNMERGED);
    expect(row.pr_number).toBeNull();
    expect(row.branch_name).toBe('feat/PROJ-1-thing');
    expect(deps.jira.addComment).toHaveBeenCalledWith('PROJ-1', expect.stringContaining('closed without merging'));
  });

  it('closes a production PR and returns the ticket to staging', async () => {
    const deps = baseDeps({ pipelineState: PIPELINE_STATES.QUEUED });
    await closeTicketPr(deps);

    expect(deps.github.closePr).toHaveBeenCalledWith(42);
    expect(deps.ticketsRepo.get('PROJ-1').pipeline_state).toBe(PIPELINE_STATES.STAGING);
    expect(deps.ticketsRepo.get('PROJ-1').branch_name).toBe('feat/PROJ-1-thing');
  });

  it('reconciles when the PR is already closed on GitHub without calling close again', async () => {
    const deps = baseDeps({ pipelineState: PIPELINE_STATES.STAGING_QUEUED, prState: 'closed' });
    const result = await closeTicketPr(deps);

    expect(result.alreadyClosed).toBe(true);
    expect(deps.github.closePr).not.toHaveBeenCalled();
    expect(deps.ticketsRepo.get('PROJ-1').pipeline_state).toBe(PIPELINE_STATES.UNMERGED);
  });

  it('refuses to close an already-merged PR', async () => {
    const deps = baseDeps({ pipelineState: PIPELINE_STATES.STAGING_QUEUED, prState: 'closed', merged: true });
    await expect(closeTicketPr(deps)).rejects.toMatchObject({ status: 409, message: expect.stringContaining('already merged') });
    expect(deps.github.closePr).not.toHaveBeenCalled();
  });

  it('throws CloseNotReadyError when there is no PR', async () => {
    const deps = baseDeps({ pipelineState: PIPELINE_STATES.UNMERGED });
    await expect(closeTicketPr(deps)).rejects.toBeInstanceOf(CloseNotReadyError);
    expect(deps.github.closePr).not.toHaveBeenCalled();
  });

  it('clears local state when the PR is gone on GitHub', async () => {
    const deps = baseDeps({ pipelineState: PIPELINE_STATES.STAGING_QUEUED });
    const err = new Error('Not Found');
    err.status = 404;
    deps.github.getPr = vi.fn().mockRejectedValue(err);

    const result = await closeTicketPr(deps);
    expect(result.gone).toBe(true);
    expect(deps.github.closePr).not.toHaveBeenCalled();
    expect(deps.ticketsRepo.get('PROJ-1').pipeline_state).toBe(PIPELINE_STATES.UNMERGED);
    expect(deps.ticketsRepo.get('PROJ-1').pr_number).toBeNull();
  });
});
