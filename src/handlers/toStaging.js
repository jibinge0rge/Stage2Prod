const { OUTCOMES, PIPELINE_STATES, JIRA_COMMENTS, refKey } = require('../lib/constants');

/**
 * Lock-free core: ensures a PR from the ticket's feature branch into
 * staging exists (reusing one a developer already opened, else creating
 * it), but never merges it — merging staging or production is always a
 * deliberate human action, done via POST /api/tickets/:key/merge (see
 * src/services/mergeOpenPr.js). Used both by the poller-driven handler
 * (wrapped in the staging lock below) and by the staging-reset re-merge
 * loop (which already holds the staging lock, so it calls this directly).
 */
async function ensureStagingPrCore({ ticketKey, log, correlationId, trigger, repoOwner, repoName, stagingBranch, github, jira, ticketsRepo, eventsRepo, ticketMatcher }) {
  const branch = await ticketMatcher.findBranchForTicket(ticketKey);
  if (!branch) {
    eventsRepo.insertEvent({
      ticketKey,
      trigger,
      action: 'pr:staging',
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

  let pr = await ticketMatcher.findOpenPrForTicket(ticketKey, { base: stagingBranch });
  let created = false;
  if (!pr) {
    const result = await github.createPr({
      base: stagingBranch,
      head: branch,
      title: `${ticketKey}: merge to ${stagingBranch}`,
      body: `Auto-opened by Stage2Prod for ${ticketKey}. Merge from the Stage2Prod dashboard when ready.`,
    });
    pr = { number: result.number, head: { ref: branch } };
    created = true;
  }

  ticketsRepo.setGithubFacts(ticketKey, { prNumber: pr.number, prState: 'open' });
  ticketsRepo.setPipelineState(ticketKey, PIPELINE_STATES.STAGING_QUEUED);
  await jira.addComment(ticketKey, JIRA_COMMENTS.STAGING_PR_OPENED(pr.number, stagingBranch));
  eventsRepo.insertEvent({
    ticketKey,
    trigger,
    action: 'pr:staging',
    outcome: OUTCOMES.PR_OPENED,
    title: created ? 'Opened PR into staging' : 'Found existing PR into staging',
    detail: `${branch} → ${stagingBranch} via PR #${pr.number}`,
    correlationId,
    metadata: { branch, prNumber: pr.number },
    repoOwner,
    repoName,
  });
  log.info({ ticketKey, branch, prNumber: pr.number, created }, 'staging PR ensured');
  return { outcome: OUTCOMES.PR_OPENED };
}

/**
 * Poller-driven handler: acquires the staging ref lock (namespaced per
 * repo and per the repo's actual staging branch name, so two repos —
 * or two differently-named staging branches — never serialize each
 * other) before ensuring the PR.
 */
async function toStaging({ event, log, correlationId, repoOwner, repoName, stagingBranch, github, jira, ticketsRepo, eventsRepo, lockManager, ticketMatcher }) {
  const trigger = `Poll · status change`;
  return lockManager.withLock(
    refKey(repoOwner, repoName, `refs/heads/${stagingBranch}`),
    `toStaging:${event.ticketKey}`,
    correlationId,
    () =>
      ensureStagingPrCore({
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

module.exports = { toStaging, ensureStagingPrCore };
