const { OUTCOMES, PIPELINE_STATES, refKey } = require('../lib/constants');
const { mergeToStagingCore } = require('../handlers/toStaging');

/**
 * POST /api/staging/reset core logic, scoped to one repo (owner/name).
 * Takes that repo's staging lock non-blocking (409s immediately if a
 * poller-driven merge is mid-flight) then force-updates the repo's
 * staging branch to its production branch's current head, and
 * optionally re-merges every ticket currently "In QA" in that repo back
 * into the fresh branch, sequentially, reusing the lock-free merge core
 * since the lock is already held here.
 */
async function resetStaging({ owner, name, productionBranch, stagingBranch, remergeInQa, correlationId, log, github, jira, ticketsRepo, eventsRepo, lockManager, ticketMatcher }) {
  return lockManager.withLockOrReject(refKey(owner, name, `refs/heads/${stagingBranch}`), 'staging-reset', correlationId, async () => {
    const previousHeadSha = await github.getRef(stagingBranch).catch(() => null);
    const productionSha = await github.getRef(productionBranch);

    await github.updateRef(stagingBranch, productionSha, { force: true });

    for (const t of ticketsRepo.listByPipelineStateAndRepo(PIPELINE_STATES.STAGING, owner, name)) {
      ticketsRepo.setPipelineState(t.ticket_key, PIPELINE_STATES.UNMERGED);
    }
    for (const t of ticketsRepo.listByPipelineStateAndRepo(PIPELINE_STATES.CONFLICT, owner, name)) {
      ticketsRepo.setPipelineState(t.ticket_key, PIPELINE_STATES.UNMERGED);
    }

    eventsRepo.insertEvent({
      trigger: 'POST /api/staging/reset',
      action: 'reset-ref',
      outcome: OUTCOMES.RESET,
      title: `Force-updated ${stagingBranch} to ${productionBranch}`,
      detail: `${owner}/${name}: refs/heads/${stagingBranch} force-updated to ${productionBranch} @ ${productionSha.slice(0, 7)}`,
      correlationId,
      metadata: { previousHeadSha, newHeadSha: productionSha },
      repoOwner: owner,
      repoName: name,
    });

    const remerge = { requested: !!remergeInQa, results: [] };
    if (remergeInQa) {
      const inQaTickets = ticketsRepo
        .listByJiraStatus('In QA')
        .filter((t) => t.repo_owner === owner && t.repo_name === name);
      for (const t of inQaTickets) {
        // eslint-disable-next-line no-await-in-loop
        const result = await mergeToStagingCore({
          ticketKey: t.ticket_key,
          log,
          correlationId,
          trigger: 'POST /api/staging/reset (remerge)',
          repoOwner: owner,
          repoName: name,
          stagingBranch,
          github,
          jira,
          ticketsRepo,
          eventsRepo,
          ticketMatcher,
        });
        remerge.results.push({ ticketKey: t.ticket_key, outcome: result.outcome });
      }
    }

    return {
      ok: true,
      repo: { owner, name },
      previousHeadSha,
      newHeadSha: productionSha,
      remerge,
      timestamp: new Date().toISOString(),
    };
  });
}

module.exports = { resetStaging };
