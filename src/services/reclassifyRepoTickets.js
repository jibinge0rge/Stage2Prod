const { OUTCOMES, PIPELINE_STATES } = require('../lib/constants');
const { pipelineStateFor } = require('./linkTicketPr');

/** Pipeline states that mean "we have (or had) a PR whose base must match staging/production". */
const RECLASSIFIABLE_STATES = new Set([
  PIPELINE_STATES.STAGING_QUEUED,
  PIPELINE_STATES.QUEUED,
  PIPELINE_STATES.CONFLICT,
  PIPELINE_STATES.STAGING,
]);

/**
 * After a watched repo's staging/production branch names change, open
 * linked PRs may suddenly point at the "wrong" role (or at neither
 * branch). Real incident: staging was ``release-4.3.0-v1``, tickets had
 * open PRs into that branch (``staging_queued``); the operator then set
 * staging=``develop`` and production=``release-4.3.0-v1`` (or later
 * ``prod``). Without reclassification those tickets either flipped to
 * "Awaiting production" the next time something found the existing PR
 * against the new production name, or stayed stuck with a PR base that
 * no longer matches either configured branch.
 *
 * For every ticket on this repo with a linked PR number: fetch the PR,
 * recompute pipeline state from its actual base vs the *new* config.
 * - Same state → no-op.
 * - Different valid state → update pipeline_state (e.g. staging→queued
 *   when the old staging branch is now production).
 * - Base matches neither → detach the PR (clear GitHub facts, keep the
 *   feature branch name) and set ``unmerged`` so the operator can open
 *   a fresh PR into the correct target.
 */
async function reclassifyRepoTickets({
  owner,
  name,
  repoConfig,
  ticketsRepo,
  eventsRepo,
  repoResolver,
  log,
  correlationId,
  trigger = 'PATCH /api/repos/:owner/:name',
}) {
  const github = repoResolver.getClient(owner, name);
  if (!github || typeof github.getPr !== 'function') return [];

  const candidates = ticketsRepo
    .list()
    .filter(
      (t) =>
        t.repo_owner === owner
        && t.repo_name === name
        && t.pr_number
        && RECLASSIFIABLE_STATES.has(t.pipeline_state)
    );

  const changes = [];
  for (const row of candidates) {
    const ticketKey = row.ticket_key;
    let pr;
    try {
      pr = await github.getPr(row.pr_number);
    } catch (err) {
      if (err.status === 404) {
        ticketsRepo.clearGithubFacts(ticketKey);
        ticketsRepo.setPipelineState(ticketKey, PIPELINE_STATES.UNMERGED);
        eventsRepo.insertEvent({
          ticketKey,
          trigger,
          action: 'reclassify',
          outcome: OUTCOMES.NOTED,
          title: 'Cleared missing PR after branch remap',
          detail: `PR #${row.pr_number} is gone on GitHub — pipeline reset to unmerged after staging/production branch change.`,
          correlationId,
          metadata: { prNumber: row.pr_number, previousState: row.pipeline_state, nextState: PIPELINE_STATES.UNMERGED },
          repoOwner: owner,
          repoName: name,
        });
        changes.push({ ticketKey, previousState: row.pipeline_state, nextState: PIPELINE_STATES.UNMERGED, detached: true });
        continue;
      }
      log.warn({ err, ticketKey, prNumber: row.pr_number }, 'reclassify: getPr failed');
      continue;
    }

    const nextState = pipelineStateFor(pr, repoConfig);
    if (nextState === row.pipeline_state) continue;

    if (!nextState) {
      ticketsRepo.clearGithubFacts(ticketKey);
      ticketsRepo.setPipelineState(ticketKey, PIPELINE_STATES.UNMERGED);
      eventsRepo.insertEvent({
        ticketKey,
        trigger,
        action: 'reclassify',
        outcome: OUTCOMES.NOTED,
        title: 'Detached PR after branch remap',
        detail: `PR #${pr.number} (\`${pr.head}\` → \`${pr.base}\`) no longer targets staging (\`${repoConfig.stagingBranch}\`) or production (\`${repoConfig.productionBranch}\`). Cleared the link; branch kept.`,
        correlationId,
        metadata: {
          prNumber: pr.number,
          prBase: pr.base,
          previousState: row.pipeline_state,
          nextState: PIPELINE_STATES.UNMERGED,
          stagingBranch: repoConfig.stagingBranch,
          productionBranch: repoConfig.productionBranch,
        },
        repoOwner: owner,
        repoName: name,
      });
      changes.push({
        ticketKey,
        previousState: row.pipeline_state,
        nextState: PIPELINE_STATES.UNMERGED,
        detached: true,
        prNumber: pr.number,
        prBase: pr.base,
      });
      continue;
    }

    ticketsRepo.setPipelineState(ticketKey, nextState);
    ticketsRepo.setGithubFacts(ticketKey, {
      branchName: pr.head,
      prNumber: pr.number,
      prState: pr.merged ? 'merged' : pr.state,
      headSha: pr.headSha ?? null,
    });
    eventsRepo.insertEvent({
      ticketKey,
      trigger,
      action: 'reclassify',
      outcome: OUTCOMES.NOTED,
      title: 'Reclassified ticket after branch remap',
      detail: `PR #${pr.number} (\`${pr.head}\` → \`${pr.base}\`): ${row.pipeline_state} → ${nextState} (staging=\`${repoConfig.stagingBranch}\`, production=\`${repoConfig.productionBranch}\`).`,
      correlationId,
      metadata: {
        prNumber: pr.number,
        prBase: pr.base,
        previousState: row.pipeline_state,
        nextState,
        stagingBranch: repoConfig.stagingBranch,
        productionBranch: repoConfig.productionBranch,
      },
      repoOwner: owner,
      repoName: name,
    });
    changes.push({
      ticketKey,
      previousState: row.pipeline_state,
      nextState,
      detached: false,
      prNumber: pr.number,
      prBase: pr.base,
    });
  }

  if (changes.length) {
    log.info({ owner, name, count: changes.length, changes }, 'reclassified tickets after branch remap');
  }
  return changes;
}

module.exports = { reclassifyRepoTickets, RECLASSIFIABLE_STATES };
