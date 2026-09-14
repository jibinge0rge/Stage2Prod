/**
 * Best-effort: move the Jira issue to `status` after a git action, then
 * record it as last-seen so the poller does not treat our own transition
 * as a new Jira-driven event (e.g. Done must not re-open a production PR
 * after we just merged one).
 *
 * `statusNames` (when given) is tried in order — used so Open / To Do /
 * Backlog aliases can all satisfy the "open" stage.
 *
 * Never throws — a missing workflow transition must not fail the git write.
 */

function pickTransition(transitions, names) {
  const list = Array.isArray(transitions) ? transitions : [];
  for (const name of names) {
    const needle = String(name || '').trim().toLowerCase();
    if (!needle) continue;
    const match =
      list.find((t) => t.to?.name && String(t.to.name).toLowerCase() === needle) ||
      list.find((t) => t.name && String(t.name).toLowerCase() === needle);
    if (match) return { match, applied: match.to?.name || match.name };
  }
  return null;
}

async function attemptTransition(jira, ticketKey, name) {
  if (typeof jira.tryTransition === 'function') return jira.tryTransition(ticketKey, name);
  if (typeof jira.transition === 'function') return jira.transition(ticketKey, name);
  return { transitioned: false, reason: 'no-client' };
}

async function syncJiraStatus({ jira, ticketsRepo, ticketKey, status, statusNames, log }) {
  const names = [...new Set((statusNames?.length ? statusNames : [status]).filter(Boolean))];
  if (!jira || names.length === 0) return { transitioned: false, reason: 'no-client' };

  let result;
  let applied = names[0];
  try {
    if (typeof jira.getTransitions === 'function') {
      const transitions = await jira.getTransitions(ticketKey);
      const picked = pickTransition(transitions, names);
      if (picked) {
        applied = picked.applied;
        result = await attemptTransition(jira, ticketKey, picked.match.name);
        if (result?.transitioned) applied = picked.applied;
      }
    }
    if (!result?.transitioned) {
      for (const name of names) {
        // eslint-disable-next-line no-await-in-loop
        result = await attemptTransition(jira, ticketKey, name);
        if (result?.transitioned) {
          applied = name;
          break;
        }
        if (result?.reason === 'no-client') return result;
      }
    }
  } catch (err) {
    log?.warn?.({ ticketKey, status: names[0], err: err.message }, 'jira status sync failed');
    return { transitioned: false, reason: 'error', error: err.message };
  }

  if (result?.transitioned) {
    ticketsRepo.setLastSeenStatus(ticketKey, applied);
    log?.info?.({ ticketKey, status: applied }, 'jira status synced from git action');
    return { ...result, status: applied };
  }

  log?.warn?.(
    { ticketKey, status: names[0], reason: result?.reason },
    'jira status not available for this ticket'
  );
  return result || { transitioned: false };
}

module.exports = { syncJiraStatus, pickTransition };
