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
    sprintName: sprintNameFromIssue(issue),
    jiraUpdatedAt: issue.fields.updated,
  };
}

function parseOneSprint(item) {
  if (!item) return null;
  if (typeof item === 'string') {
    // Older Jira/GreenHopper serializes sprints as
    // "com.atlassian.greenhopper.service.sprint.Sprint@…[name=SCRUM Sprint 0,state=ACTIVE,…]".
    const name = (item.match(/name=([^,\]]+)/) || [])[1] || null;
    const state = ((item.match(/state=(\w+)/) || [])[1] || '').toLowerCase();
    return name ? { name, state } : null;
  }
  if (typeof item === 'object' && item.name) {
    return { name: item.name, state: (item.state || '').toLowerCase() };
  }
  return null;
}

function parseSprintish(value) {
  if (!value) return [];
  const items = Array.isArray(value) ? value : [value];
  return items.map(parseOneSprint).filter(Boolean);
}

function looksLikeSprintField(value) {
  const first = Array.isArray(value) ? value[0] : value;
  if (!first) return false;
  if (typeof first === 'string') {
    return first.includes('greenhopper.service.sprint') || /name=/.test(first);
  }
  return Boolean(first.name && (first.state || first.boardId || first.originBoardId || first.id));
}

function pickSprintName(sprints) {
  if (!sprints.length) return null;
  const active = sprints.find((s) => s.state === 'active') || sprints[sprints.length - 1];
  return active.name;
}

function extractSprintName(sprintField) {
  return pickSprintName(parseSprintish(sprintField));
}

/**
 * Jira Cloud stores sprint on a Software custom field (usually
 * customfield_10020), not `fields.sprint`. Read whichever shape came back.
 */
function sprintNameFromIssue(issue) {
  const fields = issue?.fields || {};
  const all = [...parseSprintish(fields.sprint), ...parseSprintish(fields.closedSprints)];
  for (const [key, value] of Object.entries(fields)) {
    if (key === 'sprint' || key === 'closedSprints') continue;
    if (looksLikeSprintField(value)) all.push(...parseSprintish(value));
  }
  return pickSprintName(all);
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

module.exports = { diffIssue, diffIssues, extractSprintName, sprintNameFromIssue };
