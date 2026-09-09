const { OUTCOMES, PIPELINE_STATES, JIRA_COMMENTS, refKey } = require('../lib/constants');

/**
 * Lock-free core: merges a single ticket's feature branch into staging.
 * Used both by the poller-driven handler (wrapped in the staging lock
 * below) and by the staging-reset re-merge loop (which already holds
 * the staging lock, so it calls this directly).
 */
async function mergeToStagingCore({ ticketKey, log, correlationId, trigger, repoOwner, repoName, stagingBranch, github, jira, ticketsRepo, eventsRepo, ticketMatcher }) {
  const branch = await ticketMatcher.findBranchForTicket(ticketKey);
  if (!branch) {
    eventsRepo.insertEvent({
      ticketKey,
      trigger,
      action: 'merge:staging',
      outcome: OUTCOMES.NOTED,
      title: 'No matching branch found',
      detail: `No branch containing "${ticketKey}" was found in ${repoOwner}/${repoName}.`,
      correlationId,
      repoOwner,
      repoName,
    });
    return { outcome: OUTCOMES.NOTED };
  }

  ticketsRepo.setGithubFacts(ticketKey, { branchName: branch });
  const result = await github.createMerge({ base: stagingBranch, head: branch });

  if (result.conflict) {
    await jira.addComment(ticketKey, JIRA_COMMENTS.STAGING_CONFLICT);
    await jira.tryTransition(ticketKey, 'Needs Attention');
    ticketsRepo.setPipelineState(ticketKey, PIPELINE_STATES.CONFLICT);
    eventsRepo.insertEvent({
      ticketKey,
      trigger,
      action: 'merge:staging',
      outcome: OUTCOMES.CONFLICT,
      title: 'Merge into staging failed',
      detail: `GitHub returned 409 — conflict merging ${branch} into ${stagingBranch}.`,
      correlationId,
      metadata: { branch },
      repoOwner,
      repoName,
    });
    log.warn({ ticketKey, branch }, 'staging merge conflict');
    return { outcome: OUTCOMES.CONFLICT };
  }

  await jira.addComment(ticketKey, JIRA_COMMENTS.STAGING_SUCCESS);
  ticketsRepo.setPipelineState(ticketKey, PIPELINE_STATES.STAGING);
  if (result.sha) ticketsRepo.setGithubFacts(ticketKey, { headSha: result.sha });
  eventsRepo.insertEvent({
    ticketKey,
    trigger,
    action: 'merge:staging',
    outcome: OUTCOMES.MERGED,
    title: 'Merged into staging',
    detail: `${branch} → ${stagingBranch}${result.sha ? `, merge commit ${result.sha.slice(0, 7)}` : ''}`,
    correlationId,
    metadata: { branch, sha: result.sha },
    repoOwner,
    repoName,
  });
  log.info({ ticketKey, branch, sha: result.sha }, 'merged into staging');
  return { outcome: OUTCOMES.MERGED };
}

/**
 * Poller-driven handler: acquires the staging ref lock (namespaced per
 * repo and per the repo's actual staging branch name, so two repos —
 * or two differently-named staging branches — never serialize each
 * other) before merging.
 */
async function toStaging({ event, log, correlationId, repoOwner, repoName, stagingBranch, github, jira, ticketsRepo, eventsRepo, lockManager, ticketMatcher }) {
  const trigger = `Poll · status change`;
  return lockManager.withLock(
    refKey(repoOwner, repoName, `refs/heads/${stagingBranch}`),
    `toStaging:${event.ticketKey}`,
    correlationId,
    () =>
      mergeToStagingCore({
        ticketKey: event.ticketKey,
        log,
        correlationId,
        trigger,
        repoOwner,
        repoName,
        stagingBranch,
        github,
        jira,
        ticketsRepo,
        eventsRepo,
        ticketMatcher,
      })
  );
}

module.exports = { toStaging, mergeToStagingCore };
