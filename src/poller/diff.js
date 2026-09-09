/**
 * Pure diff: given a raw Jira issue and the last-seen status stored for
 * that ticket, returns a StatusChangeEvent if the status changed (or this
 * is the first time we've seen the ticket), else null. No I/O — fully
 * unit-testable.
 */
function diffIssue(issue, lastSeenStatus) {
  const status = issue.fields.status.name;
  if (lastSeenStatus === status) return null;
  return {
    ticketKey: issue.key,
    newStatus: status,
    previousStatus: lastSeenStatus ?? null,
    summary: issue.fields.summary,
    assigneeName: issue.fields.assignee ? issue.fields.assignee.displayName : null,
    assigneeAvatarUrl: issue.fields.assignee ? issue.fields.assignee.avatarUrls?.['48x48'] : null,
    sprintName: extractSprintName(issue.fields.sprint),
    jiraUpdatedAt: issue.fields.updated,
  };
}

function extractSprintName(sprintField) {
  if (!sprintField) return null;
  if (Array.isArray(sprintField)) {
    const active = sprintField.find((s) => s.state === 'active') || sprintField[sprintField.length - 1];
    return active ? active.name : null;
  }
  return sprintField.name || null;
}

/**
 * Diffs a full batch of issues against the ticketsRepo's stored last-seen
 * statuses, returning events sorted oldest-updated-first for sequential
 * processing.
 */
function diffIssues(issues, getLastSeenStatus) {
  const events = [];
  for (const issue of issues) {
    const lastSeen = getLastSeenStatus(issue.key);
    const event = diffIssue(issue, lastSeen);
    if (event) events.push(event);
  }
  events.sort((a, b) => new Date(a.jiraUpdatedAt) - new Date(b.jiraUpdatedAt));
  return events;
}

module.exports = { diffIssue, diffIssues, extractSprintName };
