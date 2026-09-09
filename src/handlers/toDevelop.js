const { OUTCOMES, PIPELINE_STATES, JIRA_COMMENTS, refKey } = require('../lib/constants');

async function mergeToDevelopCore({ ticketKey, log, correlationId, trigger, repoOwner, repoName, productionBranch, github, jira, ticketsRepo, eventsRepo, ticketMatcher }) {
  const pr = await ticketMatcher.findOpenPrForTicket(ticketKey, { base: productionBranch });
  if (!pr) {
    eventsRepo.insertEvent({
      ticketKey,
      trigger,
      action: 'merge:develop',
      outcome: OUTCOMES.NOTED,
      title: 'No matching open PR found',
      detail: `No open PR with base "${productionBranch}" found for ${ticketKey} in ${repoOwner}/${repoName}.`,
      correlationId,
      repoOwner,
      repoName,
    });
    return { outcome: OUTCOMES.NOTED };
  }

  ticketsRepo.setGithubFacts(ticketKey, { branchName: pr.head.ref, prNumber: pr.number, prState: 'open', headSha: pr.head.sha });

  const status = await github.getCombinedStatus(pr.head.sha);
  ticketsRepo.setGithubFacts(ticketKey, { checkStatus: status.overall });

  if (status.overall !== 'passing') {
    const reason = status.overall === 'failing' ? 'status checks are failing' : 'status checks are still pending';
    await jira.addComment(ticketKey, `Develop merge held — ${reason} on PR #${pr.number}.`);
    eventsRepo.insertEvent({
      ticketKey,
      trigger,
      action: 'merge:develop',
      outcome: OUTCOMES.HELD,
      title: 'Held develop merge',
      detail: `PR #${pr.number}: ${reason}`,
      correlationId,
      metadata: { prNumber: pr.number, checkStatus: status.overall },
      repoOwner,
      repoName,
    });
    log.info({ ticketKey, prNumber: pr.number, checkStatus: status.overall }, 'develop merge held');
    return { outcome: OUTCOMES.HELD };
  }

  const merged = await github.mergePr(pr.number, { mergeMethod: 'merge' });
  await github.deleteRef(pr.head.ref);
  await jira.addComment(ticketKey, JIRA_COMMENTS.DEVELOP_SUCCESS);
  ticketsRepo.setPipelineState(ticketKey, PIPELINE_STATES.DEVELOP);
  ticketsRepo.setGithubFacts(ticketKey, { prState: 'merged', headSha: merged.sha });
  eventsRepo.insertEvent({
    ticketKey,
    trigger,
    action: 'merge:develop',
    outcome: OUTCOMES.MERGED,
    title: 'Merged into develop',
    detail: `PR #${pr.number} merged as merge commit · remote branch deleted`,
    correlationId,
    metadata: { prNumber: pr.number, branch: pr.head.ref, sha: merged.sha },
    repoOwner,
    repoName,
  });
  log.info({ ticketKey, prNumber: pr.number }, 'merged into develop');
  return { outcome: OUTCOMES.MERGED };
}

async function toDevelop({ event, log, correlationId, repoOwner, repoName, productionBranch, github, jira, ticketsRepo, eventsRepo, lockManager, ticketMatcher }) {
  const trigger = `Poll · status change`;
  return lockManager.withLock(
    refKey(repoOwner, repoName, `refs/heads/${productionBranch}`),
    `toDevelop:${event.ticketKey}`,
    correlationId,
    () =>
      mergeToDevelopCore({
        ticketKey: event.ticketKey,
        log,
        correlationId,
        trigger,
        repoOwner,
        repoName,
        productionBranch,
        github,
        jira,
        ticketsRepo,
        eventsRepo,
        ticketMatcher,
      })
  );
}

module.exports = { toDevelop, mergeToDevelopCore };
