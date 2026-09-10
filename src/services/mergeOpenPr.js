const { OUTCOMES, PIPELINE_STATES, JIRA_COMMENTS, JIRA_STATUSES, refKey } = require('../lib/constants');
const { syncJiraStatus } = require('../lib/syncJiraStatus');

class MergeNotReadyError extends Error {
  constructor(pipelineState) {
    super(`Ticket has no pull request awaiting merge (pipeline state: ${pipelineState})`);
    this.status = 400;
  }
}

// A ticket can be merged from any of these states — including `conflict`,
// so a previously-failed attempt can be retried once the real cause is
// fixed (the PR resolved on GitHub, or a fresh PR opened via a new Jira
// transition). Retrying is safe: the PR's *actual* base branch (fetched
// from GitHub below) decides the target, not the stale pipeline_state.
const RETRYABLE_STATES = [PIPELINE_STATES.STAGING_QUEUED, PIPELINE_STATES.QUEUED, PIPELINE_STATES.CONFLICT];

function targetFor(prBaseRef, { productionBranch, stagingBranch }) {
  if (prBaseRef === stagingBranch) return 'staging';
  if (prBaseRef === productionBranch) return 'develop';
  return null;
}

/**
 * The human-triggered merge action — the only place either staging or
 * production ever actually gets written to. `ensureStagingPrCore` /
 * `ensureDevelopPrCore` (the poller-driven handlers) only ever open a PR
 * and stop; this is what a person calls (via POST /api/tickets/:key/merge)
 * once they've decided a PR is ready.
 *
 * GitHub doesn't report "the branch behind this PR was deleted" as a
 * distinct error from "there's a real merge conflict" — both just make
 * the PR unmergeable. So before ever calling the merge API, this checks
 * the PR's live state first and gives an accurate reason (gone, closed,
 * already merged) instead of defaulting every failure to "conflict."
 */
async function mergeOpenPr({ ticketKey, repoOwner, repoName, productionBranch, stagingBranch, github, jira, ticketsRepo, eventsRepo, lockManager, log, correlationId, trigger = 'POST /api/tickets/:key/merge' }) {
  const row = ticketsRepo.get(ticketKey);
  if (!row) {
    const err = new Error(`No ticket ${ticketKey}`);
    err.status = 404;
    throw err;
  }
  if (!RETRYABLE_STATES.includes(row.pipeline_state) || !row.pr_number) {
    throw new MergeNotReadyError(row.pipeline_state);
  }

  const prNumber = row.pr_number;

  // Genuinely retryable: the PR still exists and is (or might become)
  // mergeable, so it's worth leaving the ticket flagged and offering a
  // retry. Distinct from "gone" below, which clears back to unmerged
  // instead, since there's nothing left to retry.
  function recordConflict(target, detail, jiraComment) {
    ticketsRepo.setPipelineState(ticketKey, PIPELINE_STATES.CONFLICT);
    eventsRepo.insertEvent({
      ticketKey,
      trigger,
      action: target === 'develop' ? 'merge:develop' : 'merge:staging',
      outcome: OUTCOMES.CONFLICT,
      title: 'Merge failed',
      detail,
      correlationId,
      metadata: { prNumber },
      repoOwner,
      repoName,
    });
    log.warn({ ticketKey, prNumber, detail }, 'merge attempt failed');
    return jira.addComment(ticketKey, jiraComment);
  }

  // Not retryable — the PR is gone or closed, so nothing about clicking
  // Merge again would ever help. Clear back to unmerged instead of
  // leaving the ticket stuck in `conflict` with no way out except a full
  // staging reset: the ticket just waits for its next real Jira
  // transition to open a fresh PR, same as it would if it had never
  // reached this state at all.
  function recordGone(target, detail, jiraComment) {
    ticketsRepo.setPipelineState(ticketKey, PIPELINE_STATES.UNMERGED);
    // Otherwise the drawer keeps showing "Pull request #N" and a frozen
    // check-status for a PR that no longer exists, which is exactly the
    // stale, misleading state this whole path exists to avoid.
    ticketsRepo.clearGithubFacts(ticketKey);
    eventsRepo.insertEvent({
      ticketKey,
      trigger,
      action: target === 'develop' ? 'merge:develop' : 'merge:staging',
      outcome: OUTCOMES.NOTED,
      title: 'PR no longer mergeable — cleared',
      detail,
      correlationId,
      metadata: { prNumber },
      repoOwner,
      repoName,
    });
    log.info({ ticketKey, prNumber, detail }, 'PR gone/closed — pipeline state cleared to unmerged');
    return jira.addComment(ticketKey, jiraComment);
  }

  // Look the PR up live rather than trusting stale local state — this is
  // also what lets a retry from `conflict` determine the right target
  // without needing to remember which branch it was originally headed to.
  const pr = await github.getPr(prNumber).catch((err) => (err.status === 404 ? null : Promise.reject(err)));

  if (!pr) {
    // Can't tell staging vs develop without the PR, so fall back to
    // whatever the ticket's current pipeline_state implies for messaging
    // purposes only.
    const guessedTarget = row.pipeline_state === PIPELINE_STATES.QUEUED ? 'develop' : 'staging';
    const comment = guessedTarget === 'develop' ? JIRA_COMMENTS.DEVELOP_PR_GONE : JIRA_COMMENTS.STAGING_PR_GONE;
    await recordGone(guessedTarget, `PR #${prNumber} no longer exists on GitHub (closed or inaccessible) — cleared, ready for a fresh Jira transition.`, comment);
    const err = new Error(`PR #${prNumber} no longer exists on GitHub. It's been cleared — transition the ticket again in Jira (after recreating the branch) to open a fresh PR.`);
    err.status = 409;
    throw err;
  }

  const target = targetFor(pr.base, { productionBranch, stagingBranch });
  if (!target) {
    const err = new Error(`PR #${prNumber}'s base branch ("${pr.base}") doesn't match this repo's staging ("${stagingBranch}") or production ("${productionBranch}") branch.`);
    err.status = 400;
    throw err;
  }
  const branchName = target === 'staging' ? stagingBranch : productionBranch;

  if (pr.merged) {
    // Already merged outside Stage2Prod (e.g. someone merged it by hand
    // on GitHub) — reconcile local state instead of erroring, since
    // there's nothing left to do.
    ticketsRepo.setPipelineState(ticketKey, target === 'develop' ? PIPELINE_STATES.DEVELOP : PIPELINE_STATES.STAGING);
    eventsRepo.insertEvent({
      ticketKey,
      trigger,
      action: target === 'develop' ? 'merge:develop' : 'merge:staging',
      outcome: OUTCOMES.NOTED,
      title: 'Already merged',
      detail: `PR #${prNumber} was already merged on GitHub outside Stage2Prod — pipeline state reconciled.`,
      correlationId,
      metadata: { prNumber },
      repoOwner,
      repoName,
    });
    if (target === 'develop') {
      await syncJiraStatus({ jira, ticketsRepo, ticketKey, status: JIRA_STATUSES.DONE, log });
    }
    return { outcome: OUTCOMES.MERGED, target, alreadyMerged: true };
  }

  if (pr.state === 'closed') {
    const comment = target === 'develop' ? JIRA_COMMENTS.DEVELOP_PR_GONE : JIRA_COMMENTS.STAGING_PR_GONE;
    await recordGone(target, `PR #${prNumber} was closed on GitHub without merging — cleared, ready for a fresh Jira transition.`, comment);
    const err = new Error(`PR #${prNumber} was closed without merging. It's been cleared — transition the ticket again in Jira (after recreating the branch) to open a fresh PR.`);
    err.status = 409;
    throw err;
  }

  const lockKey = refKey(repoOwner, repoName, `refs/heads/${branchName}`);

  return lockManager.withLock(lockKey, `mergeOpenPr:${ticketKey}`, correlationId, async () => {
    try {
      const merged = await github.mergePr(prNumber, { mergeMethod: 'merge' });

      if (target === 'develop') {
        await github.deleteRef(pr.head);
        ticketsRepo.setPipelineState(ticketKey, PIPELINE_STATES.DEVELOP);
        ticketsRepo.setGithubFacts(ticketKey, { prState: 'merged', headSha: merged.sha });
        await jira.addComment(ticketKey, JIRA_COMMENTS.DEVELOP_SUCCESS);
        await syncJiraStatus({ jira, ticketsRepo, ticketKey, status: JIRA_STATUSES.DONE, log });
        eventsRepo.insertEvent({
          ticketKey,
          trigger,
          action: 'merge:develop',
          outcome: OUTCOMES.MERGED,
          title: 'Merged into develop',
          detail: `PR #${prNumber} merged as merge commit · remote branch deleted`,
          correlationId,
          metadata: { prNumber, branch: pr.head, sha: merged.sha },
          repoOwner,
          repoName,
        });
        log.info({ ticketKey, prNumber }, 'merged into develop');
      } else {
        ticketsRepo.setPipelineState(ticketKey, PIPELINE_STATES.STAGING);
        ticketsRepo.setGithubFacts(ticketKey, { prState: 'merged', headSha: merged.sha });
        await jira.addComment(ticketKey, JIRA_COMMENTS.STAGING_SUCCESS);
        eventsRepo.insertEvent({
          ticketKey,
          trigger,
          action: 'merge:staging',
          outcome: OUTCOMES.MERGED,
          title: 'Merged into staging',
          detail: `PR #${prNumber} merged into ${stagingBranch}${merged.sha ? `, merge commit ${merged.sha.slice(0, 7)}` : ''}`,
          correlationId,
          metadata: { prNumber, branch: pr.head, sha: merged.sha },
          repoOwner,
          repoName,
        });
        log.info({ ticketKey, prNumber }, 'merged into staging');
      }
      return { outcome: OUTCOMES.MERGED, target };
    } catch (err) {
      if (err.status === 405 || err.status === 409) {
        const comment = target === 'develop' ? JIRA_COMMENTS.DEVELOP_CONFLICT : JIRA_COMMENTS.STAGING_CONFLICT;
        await recordConflict(target, `GitHub refused to merge PR #${prNumber} into ${branchName} (${err.status}) — not mergeable.`, comment);
        const conflictErr = new Error(`PR #${prNumber} can't be merged cleanly. Resolve the conflict on GitHub, then click Merge here again.`);
        conflictErr.status = 409;
        throw conflictErr;
      }
      throw err;
    }
  });
}

module.exports = { mergeOpenPr, MergeNotReadyError };
