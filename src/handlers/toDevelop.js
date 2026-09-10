const { OUTCOMES, PIPELINE_STATES, JIRA_COMMENTS, refKey } = require('../lib/constants');

/**
 * Lock-free core: ensures a PR into production exists (reusing one a
 * developer already opened, else creating one from the ticket's matched
 * feature branch), but never merges it — see the note in toStaging.js.
 * Status checks are still fetched and stored for display, but no longer
 * gate anything here (they used to hold the auto-merge; now a human sees
 * them in the ticket drawer before deciding to click Merge themselves).
 */
async function ensureDevelopPrCore({ ticketKey, log, correlationId, trigger, repoOwner, repoName, productionBranch, github, jira, ticketsRepo, eventsRepo, ticketMatcher }) {
  let pr = await ticketMatcher.findOpenPrForTicket(ticketKey, { base: productionBranch });
  let created = false;

  if (!pr) {
    const branch = await ticketMatcher.findBranchForTicket(ticketKey);
    if (!branch) {
      eventsRepo.insertEvent({
        ticketKey,
        trigger,
        action: 'pr:develop',
        outcome: OUTCOMES.NOTED,
        title: 'No matching branch or PR found',
        detail: `No open PR with base "${productionBranch}" and no branch containing "${ticketKey}" was found in ${repoOwner}/${repoName}.`,
        correlationId,
        repoOwner,
        repoName,
      });
      return { outcome: OUTCOMES.NOTED };
    }
    const result = await github.createPr({
      base: productionBranch,
      head: branch,
      title: `${ticketKey}: merge to ${productionBranch}`,
      body: `Auto-opened by Stage2Prod for ${ticketKey}. Merge from the Stage2Prod dashboard when ready.`,
    });
    pr = { number: result.number, head: { ref: branch, sha: result.headSha } };
    created = true;
  }

  ticketsRepo.setGithubFacts(ticketKey, { branchName: pr.head.ref, prNumber: pr.number, prState: 'open', headSha: pr.head.sha });

  if (pr.head.sha) {
    const status = await github.getCombinedStatus(pr.head.sha).catch(() => null);
    if (status) ticketsRepo.setGithubFacts(ticketKey, { checkStatus: status.overall });
  }

  ticketsRepo.setPipelineState(ticketKey, PIPELINE_STATES.QUEUED);
  await jira.addComment(ticketKey, JIRA_COMMENTS.DEVELOP_PR_OPENED(pr.number, productionBranch));
  eventsRepo.insertEvent({
    ticketKey,
    trigger,
    action: 'pr:develop',
    outcome: OUTCOMES.PR_OPENED,
    title: created ? 'Opened PR into develop' : 'Found existing PR into develop',
    detail: `PR #${pr.number} → ${productionBranch}`,
    correlationId,
    metadata: { prNumber: pr.number, branch: pr.head.ref },
    repoOwner,
    repoName,
  });
  log.info({ ticketKey, prNumber: pr.number, created }, 'develop PR ensured');
  return { outcome: OUTCOMES.PR_OPENED };
}

async function toDevelop({ event, log, correlationId, repoOwner, repoName, productionBranch, github, jira, ticketsRepo, eventsRepo, lockManager, ticketMatcher }) {
  const trigger = `Poll · status change`;
  return lockManager.withLock(
    refKey(repoOwner, repoName, `refs/heads/${productionBranch}`),
    `toDevelop:${event.ticketKey}`,
    correlationId,
    () =>
      ensureDevelopPrCore({
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

module.exports = { toDevelop, ensureDevelopPrCore };
