const { PIPELINE_STATES } = require('../lib/constants');

/**
 * Align pipeline_state with GitHub PR mergeability (file conflicts vs clean).
 * Returns the effective pipeline state after any update.
 */
async function syncPipelineWithPrMergeability(row, { ticketsRepo, reposRepo, github }) {
  if (!row?.pr_number || !row.repo_owner || !github || typeof github.getPr !== 'function') {
    return row.pipeline_state;
  }

  const awaitingMerge = [
    PIPELINE_STATES.STAGING_QUEUED,
    PIPELINE_STATES.QUEUED,
    PIPELINE_STATES.CONFLICT,
  ].includes(row.pipeline_state);
  if (!awaitingMerge) return row.pipeline_state;

  const pr = await github.getPr(row.pr_number).catch(() => null);
  if (!pr || pr.state !== 'open') return row.pipeline_state;

  const repoConfig = reposRepo?.get(row.repo_owner, row.repo_name);
  const stagingBranch = repoConfig?.stagingBranch ?? 'staging';
  const hasFileConflict = pr.mergeable === false || pr.mergeableState === 'dirty';

  if (hasFileConflict) {
    if (row.pipeline_state !== PIPELINE_STATES.CONFLICT) {
      ticketsRepo.setPipelineState(row.ticket_key, PIPELINE_STATES.CONFLICT);
    }
    return PIPELINE_STATES.CONFLICT;
  }

  if (row.pipeline_state === PIPELINE_STATES.CONFLICT) {
    const restored = pr.base === stagingBranch ? PIPELINE_STATES.STAGING_QUEUED : PIPELINE_STATES.QUEUED;
    ticketsRepo.setPipelineState(row.ticket_key, restored);
    return restored;
  }

  return row.pipeline_state;
}

async function reconcileMergeConflicts(rows, { ticketsRepo, reposRepo, repoResolver }) {
  const candidates = rows.filter(
    (r) =>
      r.pr_number
      && r.repo_owner
      && [PIPELINE_STATES.STAGING_QUEUED, PIPELINE_STATES.QUEUED, PIPELINE_STATES.CONFLICT].includes(
        r.pipeline_state
      )
  );
  await Promise.all(
    candidates.map(async (row) => {
      const github = repoResolver.getClient(row.repo_owner, row.repo_name);
      row.pipeline_state = await syncPipelineWithPrMergeability(row, {
        ticketsRepo,
        reposRepo,
        github,
      });
    })
  );
}

module.exports = { syncPipelineWithPrMergeability, reconcileMergeConflicts };
