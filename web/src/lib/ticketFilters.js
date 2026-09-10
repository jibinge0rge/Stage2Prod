const DEV_JIRA_STATUSES = new Set(['in progress', 'in development']);
const LEFT_DEVELOPMENT = new Set(['staging', 'queued', 'develop']);

/** Tickets still being worked — Jira In Progress / In Development, not yet on staging or production. */
export function isUnderDevelopment(ticket) {
  const status = (ticket.jiraStatus || '').trim().toLowerCase();
  if (!DEV_JIRA_STATUSES.has(status)) return false;
  return !LEFT_DEVELOPMENT.has(ticket.pipelineState);
}
