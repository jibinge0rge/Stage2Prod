const { OUTCOMES, PIPELINE_STATES, JIRA_COMMENTS, refKey } = require('../lib/constants');

class CloseNotReadyError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

const CLOSABLE_STATES = [PIPELINE_STATES.STAGING_QUEUED, PIPELINE_STATES.QUEUED, PIPELINE_STATES.CONFLICT];

function targetFor(prBaseRef, { productionBranch, stagingBranch }) {
  if (prBaseRef === stagingBranch) return 'staging';
  if (prBaseRef === productionBranch) return 'develop';
  return null;
}

function nextStateFor(target) {
  return target === 'develop' ? PIPELINE_STATES.STAGING : PIPELINE_STATES.UNMERGED;
}

/**
 * Human-triggered close of the ticket's open PR. Does not delete the
 * feature branch. Staging PRs go back to unmerged; production PRs go
 * back to staging so a new PR can be opened later.
 */
async function closeTicketPr({
  ticketKey,
  repoOwner,
  repoName,
  productionBranch,
  stagingBranch,
  github,
  jira,
  ticketsRepo,
  eventsRepo,
  lockManager,
  log,
  correlationId,
  trigger = 'POST /api/tickets/:key/pr/close',
}) {
  const row = ticketsRepo.get(ticketKey);
  if (!row) {
    const err = new Error(`No ticket ${ticketKey}`);
    err.status = 404;
    throw err;
  }
  if (!CLOSABLE_STATES.includes(row.pipeline_state) || !row.pr_number) {
    throw new CloseNotReadyError(
      `Ticket has no open pull request to close (pipeline state: ${row.pipeline_state})`
    );
  }

  const prNumber = row.pr_number;
  const pr = await github.getPr(prNumber).catch((err) => (err.status === 404 ? null : Promise.reject(err)));

  function recordClosed({ target, alreadyClosed, gone }) {
    const nextState = nextStateFor(target);
    ticketsRepo.setPipelineState(ticketKey, nextState);
    ticketsRepo.clearGithubFacts(ticketKey);
    const branchName = target === 'staging' ? stagingBranch : productionBranch;
    eventsRepo.insertEvent({
      ticketKey,
      trigger,
      action: target === 'develop' ? 'pr:develop' : 'pr:staging',
      outcome: OUTCOMES.NOTED,
      title: gone ? 'PR no longer open — cleared' : alreadyClosed ? 'PR already closed' : 'Closed pull request',
      detail: gone
        ? `PR #${prNumber} is gone on GitHub — pipeline cleared, branch kept.`
        : `PR #${prNumber} into ${branchName} closed without merging. Branch kept.`,
      correlationId,
      metadata: { prNumber, alreadyClosed: !!alreadyClosed, gone: !!gone },
      repoOwner,
      repoName,
    });
    log.info({ ticketKey, prNumber, target, alreadyClosed, gone }, 'PR closed');
    const comment =
      target === 'develop'
        ? JIRA_COMMENTS.DEVELOP_PR_CLOSED(prNumber, productionBranch)
        : JIRA_COMMENTS.STAGING_PR_CLOSED(prNumber, stagingBranch);
    return jira.addComment(ticketKey, comment);
  }

  if (!pr) {
    const guessedTarget = row.pipeline_state === PIPELINE_STATES.QUEUED ? 'develop' : 'staging';
    await recordClosed({ target: guessedTarget, gone: true });
    return { outcome: OUTCOMES.NOTED, alreadyClosed: true, gone: true };
  }

  if (pr.merged) {
    const err = new Error(
      `PR #${prNumber} is already merged. Closing it here would not undo that — use a revert if you need to take it back.`
    );
    err.status = 409;
    throw err;
  }

  const target = targetFor(pr.base, { productionBranch, stagingBranch });
  if (!target) {
    const err = new Error(
      `PR #${prNumber}'s base branch ("${pr.base}") doesn't match this repo's staging ("${stagingBranch}") or production ("${productionBranch}") branch.`
    );
    err.status = 400;
    throw err;
  }

  if (pr.state === 'closed') {
    await recordClosed({ target, alreadyClosed: true });
    return { outcome: OUTCOMES.NOTED, target, alreadyClosed: true };
  }

  const branchName = target === 'staging' ? stagingBranch : productionBranch;
  const lockKey = refKey(repoOwner, repoName, `refs/heads/${branchName}`);

  return lockManager.withLock(lockKey, `closeTicketPr:${ticketKey}`, correlationId, async () => {
    await github.closePr(prNumber);
    await recordClosed({ target });
    return { outcome: OUTCOMES.NOTED, target };
  });
}

module.exports = { closeTicketPr, CloseNotReadyError };
