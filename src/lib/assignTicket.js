const { OUTCOMES } = require('./constants');
const { defaultPersonForRole, TEAM_ROLE_META } = require('./teamRoles');

/**
 * Best-effort Jira assignee write, then mirror the name/avatar onto the
 * local ticket row. Never throws — a missing assignable user must not
 * fail the git write that triggered the assignment.
 */
async function assignTicket({
  jira,
  ticketsRepo,
  eventsRepo,
  ticketKey,
  person,
  log,
  trigger = 'assign',
  repoOwner = null,
  repoName = null,
  reason = null,
}) {
  if (!person?.accountId) return { assigned: false, reason: 'no-person' };
  if (!jira) return { assigned: false, reason: 'no-client' };

  let result;
  try {
    if (typeof jira.tryAssign === 'function') {
      result = await jira.tryAssign(ticketKey, person.accountId);
    } else if (typeof jira.assign === 'function') {
      result = await jira.assign(ticketKey, person.accountId);
    } else {
      return { assigned: false, reason: 'no-client' };
    }
  } catch (err) {
    log?.warn?.({ ticketKey, accountId: person.accountId, err: err.message }, 'jira assign failed');
    return { assigned: false, reason: 'error', error: err.message };
  }

  if (result?.assigned === false) {
    log?.warn?.(
      { ticketKey, accountId: person.accountId, reason: result.reason },
      'jira assign did not apply'
    );
    return result;
  }

  ticketsRepo?.setAssignee?.(ticketKey, {
    name: person.displayName || person.accountId,
    avatarUrl: person.avatarUrl || null,
  });

  eventsRepo?.insertEvent?.({
    ticketKey,
    trigger,
    action: 'jira:assign',
    outcome: OUTCOMES.NOTED,
    title: `Assigned to ${person.displayName || person.accountId}`,
    detail: reason,
    correlationId: null,
    repoOwner,
    repoName,
  });
  log?.info?.({ ticketKey, accountId: person.accountId }, 'jira assignee updated');
  return { assigned: true, person };
}

async function assignTicketToRole({
  jira,
  ticketsRepo,
  eventsRepo,
  ticketKey,
  teamRoles,
  role,
  log,
  trigger,
  repoOwner,
  repoName,
}) {
  const people = teamRoles?.[role] || [];
  const person = defaultPersonForRole(teamRoles, role);
  const label = TEAM_ROLE_META[role]?.label || role;

  if (people.length === 0) {
    log?.info?.({ ticketKey, role }, 'no people configured for role, skipping assign');
    return { assigned: false, reason: 'empty-role' };
  }

  if (!person) {
    const detail = `Multiple ${label} are configured and none is the default. Set a default ${label} on the repo.`;
    eventsRepo?.insertEvent?.({
      ticketKey,
      trigger: trigger || 'assign',
      action: 'jira:assign',
      outcome: OUTCOMES.NOTED,
      title: `Skipped ${label} assignment`,
      detail,
      repoOwner,
      repoName,
    });
    log?.info?.({ ticketKey, role }, 'no default person for role, skipping assign');
    return { assigned: false, reason: 'no-default' };
  }

  return assignTicket({
    jira,
    ticketsRepo,
    eventsRepo,
    ticketKey,
    person,
    log,
    trigger,
    repoOwner,
    repoName,
    reason: `Auto-assigned ${label} for this repo`,
  });
}

module.exports = { assignTicket, assignTicketToRole };
