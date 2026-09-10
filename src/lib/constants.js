const OUTCOMES = Object.freeze({
  MERGED: 'MERGED',
  PR_OPENED: 'PR_OPENED',
  CONFLICT: 'CONFLICT',
  HELD: 'HELD',
  NOTED: 'NOTED',
  RESET: 'RESET',
  LOCK: 'LOCK',
});

const PIPELINE_STATES = Object.freeze({
  STAGING_QUEUED: 'staging_queued', // PR opened into staging, awaiting a human to click Merge
  STAGING: 'staging',
  QUEUED: 'queued', // PR opened into production, awaiting a human to click Merge
  DEVELOP: 'develop',
  CONFLICT: 'conflict',
  REJECTED: 'rejected',
  UNMERGED: 'unmerged',
});

const JIRA_COMMENTS = Object.freeze({
  STAGING_PR_OPENED: (prNumber, stagingBranch) =>
    `Pull request #${prNumber} opened into \`${stagingBranch}\`. Merge it from Stage2Prod when you're ready.`,
  STAGING_CONFLICT: 'This pull request cannot be merged into staging cleanly. Please resolve the conflict on GitHub, then merge from Stage2Prod again.',
  STAGING_PR_GONE: 'The pull request into staging no longer exists on GitHub (closed or its branch was deleted). Recreate the branch and transition this ticket again in Jira to open a fresh one.',
  STAGING_SUCCESS: 'Merged into `staging` successfully. Ready for validation.',
  DEVELOP_PR_OPENED: (prNumber, productionBranch) =>
    `Pull request #${prNumber} opened into \`${productionBranch}\`. Merge it from Stage2Prod when you're ready.`,
  DEVELOP_CONFLICT: 'This pull request cannot be merged into production cleanly. Please resolve the conflict on GitHub, then merge from Stage2Prod again.',
  DEVELOP_PR_GONE: 'The pull request into production no longer exists on GitHub (closed or its branch was deleted). Recreate the branch and transition this ticket again in Jira to open a fresh one.',
  DEVELOP_SUCCESS: 'Merged into `develop` and branch deleted.',
  REJECTED: 'Feature rejected. Branch remains unmerged into develop.',
});

// Short ref names, as displayed/stored in lock_events.ref_name. A lock key
// must be namespaced per repo (see refKey) — two different repos' staging
// branches must never serialize each other.
const SHORT_REF_STAGING = 'refs/heads/staging';
const SHORT_REF_DEVELOP = 'refs/heads/develop';

/**
 * Builds the RefLockManager key for a given repo + short ref, e.g.
 * refKey('acme', 'widgets', SHORT_REF_STAGING) -> 'acme/widgets#refs/heads/staging'.
 */
function refKey(owner, name, shortRef) {
  return `${owner}/${name}#${shortRef}`;
}

const STATUS_HANDLER_MAP = Object.freeze({
  'Ready for QA': 'toStaging',
  'In QA': 'toStaging',
  Approved: 'toDevelop',
  'Ready for Release': 'toDevelop',
  Done: 'toDevelop',
  'In Development': 'rejected',
  'QA Failed': 'rejected',
});

module.exports = {
  OUTCOMES,
  PIPELINE_STATES,
  JIRA_COMMENTS,
  SHORT_REF_STAGING,
  SHORT_REF_DEVELOP,
  refKey,
  STATUS_HANDLER_MAP,
};
