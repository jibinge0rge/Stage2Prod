const { OUTCOMES, PIPELINE_STATES, refKey } = require('../lib/constants');
const { ensureStagingPrCore } = require('../handlers/toStaging');
const { stageForJiraStatus } = require('../lib/statusHandlerMap');

function isBranchProtectionError(err) {
  if (!err || (err.status !== 403 && err.status !== 422)) return false;
  const msg = String(err.message || '').toLowerCase();
  return (
    msg.includes('protected')
    || msg.includes('cannot force')
    || msg.includes('force push')
    || msg.includes('force-push')
    || msg.includes('not authorized')
    || msg.includes('resource not accessible')
  );
}

async function openResetPullRequest({ github, owner, name, productionBranch, stagingBranch, productionSha }) {
  const open = await github.listOpenPulls().catch(() => []);
  const existing = open.find(
    (pr) => pr.base?.ref === stagingBranch && pr.head?.ref === productionBranch
  );
  if (existing) {
    return {
      number: existing.number,
      htmlUrl: existing.html_url,
      headSha: existing.head?.sha ?? productionSha,
      reused: true,
    };
  }

  const short = productionSha.slice(0, 7);
  const pr = await github.createPr({
    base: stagingBranch,
    head: productionBranch,
    title: `Reset ${stagingBranch} to ${productionBranch} @ ${short}`,
    body: [
      '## Staging sandbox reset',
      '',
      `Stage2Prod could not force-update \`${stagingBranch}\` (branch protection).`,
      `This PR brings \`${stagingBranch}\` in line with \`${productionBranch}\` @ \`${short}\`.`,
      '',
      'If staging has commits that are not on production, merging this PR will **not** discard them — an admin must temporarily allow a force-push (or disable protection) and retry Reset from Stage2Prod.',
      '',
      '_Opened automatically by Stage2Prod._',
    ].join('\n'),
  });
  return { ...pr, reused: false };
}

/**
 * POST /api/staging/reset core logic, scoped to one repo (owner/name).
 * Force-updates staging to production when allowed; if the staging branch
 * is protected, opens (or reuses) a PR instead and leaves ticket state alone.
 * Optionally re-opens a staging PR for every ticket currently in the
 * mapped "In QA" stage in that repo (force path only).
 */
async function resetStaging({
  owner,
  name,
  productionBranch,
  stagingBranch,
  statusMap,
  remergeInQa,
  correlationId,
  log,
  github,
  jira,
  ticketsRepo,
  eventsRepo,
  lockManager,
  ticketMatcher,
}) {
  return lockManager.withLockOrReject(refKey(owner, name, `refs/heads/${stagingBranch}`), 'staging-reset', correlationId, async () => {
    const previousHeadSha = await github.getRef(stagingBranch).catch(() => null);
    const productionSha = await github.getRef(productionBranch);

    let method = 'force';
    let pullRequest = null;

    if (previousHeadSha === productionSha) {
      method = 'already_aligned';
    } else {
      try {
        await github.updateRef(stagingBranch, productionSha, { force: true });
      } catch (err) {
        if (!isBranchProtectionError(err)) throw err;

        log.warn(
          { err: err.message, status: err.status, stagingBranch, productionBranch },
          'Staging force-update blocked by branch protection; opening reset PR'
        );

        try {
          pullRequest = await openResetPullRequest({
            github,
            owner,
            name,
            productionBranch,
            stagingBranch,
            productionSha,
          });
        } catch (prErr) {
          const detail = String(prErr.message || prErr);
          const err = new Error(
            `${stagingBranch} is protected and a reset PR could not be opened (${detail}). `
              + 'Ask an admin to allow a force-push (or disable protection), then retry.'
          );
          err.status = 409;
          err.code = 'staging_protected';
          throw err;
        }

        eventsRepo.insertEvent({
          trigger: 'POST /api/staging/reset',
          action: 'reset-pr',
          outcome: OUTCOMES.PR_OPENED,
          title: pullRequest.reused
            ? `Reuse reset PR #${pullRequest.number}`
            : `Opened reset PR #${pullRequest.number}`,
          detail:
            `${owner}/${name}: ${stagingBranch} is protected — `
            + `${pullRequest.reused ? 'reused' : 'opened'} PR #${pullRequest.number} `
            + `(${productionBranch} → ${stagingBranch})`,
          correlationId,
          metadata: {
            previousHeadSha,
            targetSha: productionSha,
            prNumber: pullRequest.number,
            prUrl: pullRequest.htmlUrl,
            reused: pullRequest.reused,
          },
          repoOwner: owner,
          repoName: name,
        });

        return {
          ok: true,
          method: 'pull_request',
          repo: { owner, name },
          previousHeadSha,
          newHeadSha: null,
          pullRequest: {
            number: pullRequest.number,
            htmlUrl: pullRequest.htmlUrl,
            reused: pullRequest.reused,
          },
          remerge: { requested: !!remergeInQa, results: [], skipped: true, reason: 'staging_protected' },
          timestamp: new Date().toISOString(),
        };
      }
    }

    for (const t of ticketsRepo.listByPipelineStateAndRepo(PIPELINE_STATES.STAGING, owner, name)) {
      ticketsRepo.setPipelineState(t.ticket_key, PIPELINE_STATES.UNMERGED);
      ticketsRepo.clearGithubFacts(t.ticket_key);
    }
    for (const t of ticketsRepo.listByPipelineStateAndRepo(PIPELINE_STATES.CONFLICT, owner, name)) {
      ticketsRepo.setPipelineState(t.ticket_key, PIPELINE_STATES.UNMERGED);
      ticketsRepo.clearGithubFacts(t.ticket_key);
    }

    eventsRepo.insertEvent({
      trigger: 'POST /api/staging/reset',
      action: 'reset-ref',
      outcome: OUTCOMES.RESET,
      title:
        method === 'already_aligned'
          ? `${stagingBranch} already at ${productionBranch}`
          : `Force-updated ${stagingBranch} to ${productionBranch}`,
      detail:
        method === 'already_aligned'
          ? `${owner}/${name}: refs/heads/${stagingBranch} already at ${productionBranch} @ ${productionSha.slice(0, 7)}; cleared on-staging ticket state`
          : `${owner}/${name}: refs/heads/${stagingBranch} force-updated to ${productionBranch} @ ${productionSha.slice(0, 7)}`,
      correlationId,
      metadata: { previousHeadSha, newHeadSha: productionSha, method },
      repoOwner: owner,
      repoName: name,
    });

    const remerge = { requested: !!remergeInQa, results: [] };
    if (remergeInQa) {
      const inQaTickets = ticketsRepo
        .list()
        .filter(
          (t) =>
            t.repo_owner === owner
            && t.repo_name === name
            && stageForJiraStatus(t.jira_status, statusMap) === 'in_qa'
        );
      for (const t of inQaTickets) {
        // eslint-disable-next-line no-await-in-loop
        const result = await ensureStagingPrCore({
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
          statusMap,
        });
        remerge.results.push({ ticketKey: t.ticket_key, outcome: result.outcome });
      }
    }

    return {
      ok: true,
      method,
      repo: { owner, name },
      previousHeadSha,
      newHeadSha: productionSha,
      pullRequest: null,
      remerge,
      timestamp: new Date().toISOString(),
    };
  });
}

module.exports = { resetStaging, isBranchProtectionError };
