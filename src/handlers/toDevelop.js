const { OUTCOMES, PIPELINE_STATES, JIRA_COMMENTS, refKey } = require('../lib/constants');
const { syncJiraStatus } = require('../lib/syncJiraStatus');
const { jiraStatusForStage } = require('../lib/statusHandlerMap');

/**
 * Lock-free core: ensures a PR into production exists (reusing one a
 * developer already opened, else creating one from the ticket's matched
 * feature branch), but never merges it — see the note in toStaging.js.
 *
 * Opens the PR then moves Jira to the mapped "Ready for release" status.
 */
async function ensureDevelopPrCore({
  ticketKey,
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
  statusMap,
}) {
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
    if (status) ticketsRepo.setCheckStatus(ticketKey, status.overall);
  }

  ticketsRepo.setPipelineState(ticketKey, PIPELINE_STATES.QUEUED);
  try {
    await jira.addComment(ticketKey, JIRA_COMMENTS.DEVELOP_PR_OPENED(pr.number, productionBranch));
  } catch (err) {
    log?.warn?.({ ticketKey, err: err.message }, 'jira comment after production PR open failed; continuing');
  }
  await syncJiraStatus({
    jira,
    ticketsRepo,
    ticketKey,
    status: jiraStatusForStage('ready_for_release', statusMap),
    log,
  });
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

async function toDevelop({
  event,
  log,
  correlationId,
  repoOwner,
  repoName,
  productionBranch,
  github,
  jira,
  ticketsRepo,
  eventsRepo,
  lockManager,
  ticketMatcher,
  statusMap,
}) {
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
        statusMap,
      })
  );
}

module.exports = { toDevelop, ensureDevelopPrCore };
