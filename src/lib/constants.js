const OUTCOMES = Object.freeze({
  MERGED: 'MERGED',
  CONFLICT: 'CONFLICT',
  HELD: 'HELD',
  NOTED: 'NOTED',
  RESET: 'RESET',
  LOCK: 'LOCK',
});

const PIPELINE_STATES = Object.freeze({
  STAGING: 'staging',
  QUEUED: 'queued',
  DEVELOP: 'develop',
  CONFLICT: 'conflict',
  REJECTED: 'rejected',
  UNMERGED: 'unmerged',
});

const JIRA_COMMENTS = Object.freeze({
  STAGING_CONFLICT: 'Automated merge to staging failed due to merge conflicts with current staging branch. Please resolve locally.',
  STAGING_SUCCESS: 'Merged into `staging` successfully. Ready for validation.',
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
