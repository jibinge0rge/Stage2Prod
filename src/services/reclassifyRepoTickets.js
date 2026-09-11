const { OUTCOMES, PIPELINE_STATES } = require('../lib/constants');
const { pipelineStateFor } = require('./linkTicketPr');

/** Pipeline states that mean "we have (or had) a PR whose base must match staging/production". */
const RECLASSIFIABLE_STATES = new Set([
  PIPELINE_STATES.STAGING_QUEUED,
  PIPELINE_STATES.QUEUED,
  PIPELINE_STATES.CONFLICT,
  PIPELINE_STATES.STAGING,
]);

function isReclassifyCandidate(row) {
  return Boolean(row?.pr_number && row?.repo_owner && RECLASSIFIABLE_STATES.has(row.pipeline_state));
}

/**
 * Recompute one ticket's pipeline state from the live GitHub PR base vs
 * the repo's current staging/production branch names.
 *
 * Used after a branch remap, and also when listing/opening tickets so a
 * PR retargeted on GitHub (e.g. release → develop) does not stay stuck
 * as "Awaiting production" forever.
 *
 * When `eventsRepo` is omitted the update is silent (dashboard refresh).
 */
async function reconcileTicketPr({
  row,
  pr,
  repoConfig,
  ticketsRepo,
  eventsRepo = null,
  correlationId = null,
  trigger = null,
  missingPr = false,
}) {
  const ticketKey = row.ticket_key;
  const previousState = row.pipeline_state;
  const owner = row.repo_owner;
  const name = row.repo_name;

  if (missingPr) {
    ticketsRepo.clearGithubFacts(ticketKey);
    ticketsRepo.setPipelineState(ticketKey, PIPELINE_STATES.UNMERGED);
    if (eventsRepo) {
      eventsRepo.insertEvent({
        ticketKey,
        trigger,
        action: 'reclassify',
        outcome: OUTCOMES.NOTED,
        title: 'Cleared missing PR after branch remap',
        detail: `PR #${row.pr_number} is gone on GitHub — pipeline reset to unmerged after staging/production branch change.`,
        correlationId,
        metadata: { prNumber: row.pr_number, previousState, nextState: PIPELINE_STATES.UNMERGED },
        repoOwner: owner,
        repoName: name,
      });
    }
    return { ticketKey, previousState, nextState: PIPELINE_STATES.UNMERGED, detached: true };
  }

  const nextState = pipelineStateFor(pr, repoConfig);
  if (nextState === previousState) return null;

  if (!nextState) {
    ticketsRepo.clearGithubFacts(ticketKey);
    ticketsRepo.setPipelineState(ticketKey, PIPELINE_STATES.UNMERGED);
    if (eventsRepo) {
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
          previousState,
          nextState: PIPELINE_STATES.UNMERGED,
          stagingBranch: repoConfig.stagingBranch,
          productionBranch: repoConfig.productionBranch,
        },
        repoOwner: owner,
        repoName: name,
      });
    }
    return {
      ticketKey,
      previousState,
      nextState: PIPELINE_STATES.UNMERGED,
      detached: true,
      prNumber: pr.number,
      prBase: pr.base,
    };
  }

  ticketsRepo.setPipelineState(ticketKey, nextState);
  ticketsRepo.setGithubFacts(ticketKey, {
    branchName: pr.head,
    prNumber: pr.number,
    prState: pr.merged ? 'merged' : pr.state,
    headSha: pr.headSha ?? null,
  });
  if (eventsRepo) {
    eventsRepo.insertEvent({
      ticketKey,
      trigger,
      action: 'reclassify',
      outcome: OUTCOMES.NOTED,
      title: 'Reclassified ticket after branch remap',
      detail: `PR #${pr.number} (\`${pr.head}\` → \`${pr.base}\`): ${previousState} → ${nextState} (staging=\`${repoConfig.stagingBranch}\`, production=\`${repoConfig.productionBranch}\`).`,
      correlationId,
      metadata: {
        prNumber: pr.number,
        prBase: pr.base,
        previousState,
        nextState,
        stagingBranch: repoConfig.stagingBranch,
        productionBranch: repoConfig.productionBranch,
      },
      repoOwner: owner,
      repoName: name,
    });
  }
  return {
    ticketKey,
    previousState,
    nextState,
    detached: false,
    prNumber: pr.number,
    prBase: pr.base,
  };
}

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
    .filter((t) => t.repo_owner === owner && t.repo_name === name && isReclassifyCandidate(t));

  const changes = [];
  for (const row of candidates) {
    // eslint-disable-next-line no-await-in-loop
    const change = await fetchAndReconcile({
      row,
      repoConfig,
      github,
      ticketsRepo,
      eventsRepo,
      correlationId,
      trigger,
      log,
    });
    if (change) changes.push(change);
  }

  if (changes.length) {
    log.info({ owner, name, count: changes.length, changes }, 'reclassified tickets after branch remap');
  }
  return changes;
}

async function fetchAndReconcile({
  row,
  repoConfig,
  github,
  ticketsRepo,
  eventsRepo,
  correlationId,
  trigger,
  log,
}) {
  const ticketKey = row.ticket_key;
  let pr;
  try {
    pr = await github.getPr(row.pr_number);
  } catch (err) {
    if (err.status === 404) {
      return reconcileTicketPr({
        row,
        repoConfig,
        ticketsRepo,
        eventsRepo,
        correlationId,
        trigger,
        missingPr: true,
      });
    }
    log.warn({ err, ticketKey, prNumber: row.pr_number }, 'reclassify: getPr failed');
    return null;
  }
  return reconcileTicketPr({
    row,
    pr,
    repoConfig,
    ticketsRepo,
    eventsRepo,
    correlationId,
    trigger,
  });
}

/**
 * Silent reconcile for tickets currently being shown — fixes drift when a
 * PR base was changed on GitHub after Stage2Prod last classified it.
 * Mutates `rows` in place so the API response matches the DB.
 */
async function reconcileOpenPrBases(rows, { ticketsRepo, reposRepo, repoResolver, log }) {
  const logger = log || { warn() {} };
  await Promise.all(
    rows.filter(isReclassifyCandidate).map(async (row) => {
      const repoConfig = reposRepo.get(row.repo_owner, row.repo_name);
      if (!repoConfig) return;
      const github = repoResolver.getClient(row.repo_owner, row.repo_name);
      if (!github || typeof github.getPr !== 'function') return;

      const change = await fetchAndReconcile({
        row,
        repoConfig,
        github,
        ticketsRepo,
        eventsRepo: null,
        log: logger,
      });
      if (!change) return;

      row.pipeline_state = change.nextState;
      if (change.detached) {
        row.pr_number = null;
        row.pr_state = null;
        row.head_sha = null;
        row.check_status = null;
      } else {
        const fresh = ticketsRepo.get(row.ticket_key);
        if (fresh) {
          row.pr_number = fresh.pr_number;
          row.pr_state = fresh.pr_state;
          row.head_sha = fresh.head_sha;
          row.branch_name = fresh.branch_name;
        }
      }
    })
  );
}

module.exports = {
  reclassifyRepoTickets,
  reconcileOpenPrBases,
  reconcileTicketPr,
  RECLASSIFIABLE_STATES,
  isReclassifyCandidate,
};
