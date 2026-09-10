const { OUTCOMES, PIPELINE_STATES, JIRA_COMMENTS, refKey } = require('../lib/constants');

class MergeNotReadyError extends Error {
  constructor(pipelineState) {
    super(`Ticket has no pull request awaiting merge (pipeline state: ${pipelineState})`);
    this.status = 400;
  }
}

/**
 * The human-triggered merge action — the only place either staging or
 * production ever actually gets written to. `ensureStagingPrCore` /
 * `ensureDevelopPrCore` (the poller-driven handlers) only ever open a PR
 * and stop; this is what a person calls (via POST /api/tickets/:key/merge)
 * once they've decided a PR is ready. Conflict detection lives here too —
 * GitHub still lets a PR be *created* even if it can't merge cleanly, so
 * a 405/409 from the merge attempt itself is the actual signal.
 */
async function mergeOpenPr({ ticketKey, repoOwner, repoName, productionBranch, stagingBranch, github, jira, ticketsRepo, eventsRepo, lockManager, log, correlationId, trigger = 'POST /api/tickets/:key/merge' }) {
  const row = ticketsRepo.get(ticketKey);
  if (!row) {
    const err = new Error(`No ticket ${ticketKey}`);
    err.status = 404;
    throw err;
  }

  let target;
  if (row.pipeline_state === PIPELINE_STATES.STAGING_QUEUED) target = 'staging';
  else if (row.pipeline_state === PIPELINE_STATES.QUEUED) target = 'develop';
  else throw new MergeNotReadyError(row.pipeline_state);

  const branchName = target === 'staging' ? stagingBranch : productionBranch;
  const lockKey = refKey(repoOwner, repoName, `refs/heads/${branchName}`);

  return lockManager.withLock(lockKey, `mergeOpenPr:${ticketKey}`, correlationId, async () => {
    try {
      const merged = await github.mergePr(row.pr_number, { mergeMethod: 'merge' });

      if (target === 'develop') {
        await github.deleteRef(row.branch_name);
        ticketsRepo.setPipelineState(ticketKey, PIPELINE_STATES.DEVELOP);
        ticketsRepo.setGithubFacts(ticketKey, { prState: 'merged', headSha: merged.sha });
        await jira.addComment(ticketKey, JIRA_COMMENTS.DEVELOP_SUCCESS);
        eventsRepo.insertEvent({
          ticketKey,
          trigger,
          action: 'merge:develop',
          outcome: OUTCOMES.MERGED,
          title: 'Merged into develop',
          detail: `PR #${row.pr_number} merged as merge commit · remote branch deleted`,
          correlationId,
          metadata: { prNumber: row.pr_number, branch: row.branch_name, sha: merged.sha },
          repoOwner,
          repoName,
        });
        log.info({ ticketKey, prNumber: row.pr_number }, 'merged into develop');
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
          detail: `PR #${row.pr_number} merged into ${stagingBranch}${merged.sha ? `, merge commit ${merged.sha.slice(0, 7)}` : ''}`,
          correlationId,
          metadata: { prNumber: row.pr_number, branch: row.branch_name, sha: merged.sha },
          repoOwner,
          repoName,
        });
        log.info({ ticketKey, prNumber: row.pr_number }, 'merged into staging');
      }
      return { outcome: OUTCOMES.MERGED, target };
    } catch (err) {
      if (err.status === 405 || err.status === 409) {
        ticketsRepo.setPipelineState(ticketKey, PIPELINE_STATES.CONFLICT);
        const comment = target === 'develop' ? JIRA_COMMENTS.DEVELOP_CONFLICT : JIRA_COMMENTS.STAGING_CONFLICT;
        await jira.addComment(ticketKey, comment);
        eventsRepo.insertEvent({
          ticketKey,
          trigger,
          action: target === 'develop' ? 'merge:develop' : 'merge:staging',
          outcome: OUTCOMES.CONFLICT,
          title: 'Merge failed',
          detail: `GitHub refused to merge PR #${row.pr_number} into ${branchName} (${err.status}) — not mergeable.`,
          correlationId,
          metadata: { prNumber: row.pr_number },
          repoOwner,
          repoName,
        });
        log.warn({ ticketKey, prNumber: row.pr_number, status: err.status }, 'merge attempt failed — conflict');
        const conflictErr = new Error('This pull request cannot be merged cleanly. Resolve the conflict on GitHub, then try again.');
        conflictErr.status = 409;
        throw conflictErr;
      }
      throw err;
    }
  });
}

module.exports = { mergeOpenPr, MergeNotReadyError };
