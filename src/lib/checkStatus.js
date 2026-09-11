/**
 * GitHub's combined commit status is `pending` when there are zero
 * statuses — the same value as "CI is still running". A PR with Checks 0
 * is not pending; it has nothing to report.
 */
function overallCheckStatus({ combinedState, statuses, checkRuns }) {
  const runs = checkRuns || [];
  const commitStatuses = statuses || [];
  if (commitStatuses.length === 0 && runs.length === 0) return null;

  const anyFailedCheck = runs.some(
    (c) => c.conclusion === 'failure' || c.conclusion === 'cancelled' || c.conclusion === 'timed_out'
  );
  const anyPendingCheck = runs.some((c) => c.status !== 'completed');
  const anyPendingStatus = commitStatuses.some((s) => s.state === 'pending');

  if (combinedState === 'failure' || anyFailedCheck) return 'failing';
  if (anyPendingCheck || anyPendingStatus) return 'pending';
  if (combinedState === 'pending' && commitStatuses.length === 0) return 'passing';
  if (combinedState === 'pending') return 'pending';
  return 'passing';
}

module.exports = { overallCheckStatus };
