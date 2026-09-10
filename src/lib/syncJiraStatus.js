/**
 * Best-effort: move the Jira issue to `status` after a git action, then
 * record it as last-seen so the poller does not treat our own transition
 * as a new Jira-driven event (e.g. Done must not re-open a production PR
 * after we just merged one).
 *
 * Never throws — a missing workflow transition must not fail the git write.
 */
async function syncJiraStatus({ jira, ticketsRepo, ticketKey, status, log }) {
  if (!jira || !status) return { transitioned: false, reason: 'no-client' };

  let result;
  try {
    if (typeof jira.tryTransition === 'function') {
      result = await jira.tryTransition(ticketKey, status);
    } else if (typeof jira.transition === 'function') {
      result = await jira.transition(ticketKey, status);
    } else {
      return { transitioned: false, reason: 'no-client' };
    }
  } catch (err) {
    log?.warn?.({ ticketKey, status, err: err.message }, 'jira status sync failed');
    return { transitioned: false, reason: 'error', error: err.message };
  }

  if (result?.transitioned) {
    ticketsRepo.setLastSeenStatus(ticketKey, status);
    log?.info?.({ ticketKey, status }, 'jira status synced from git action');
  } else {
    log?.warn?.(
      { ticketKey, status, reason: result?.reason },
      'jira status not available for this ticket'
    );
  }
  return result || { transitioned: false };
}

module.exports = { syncJiraStatus };
