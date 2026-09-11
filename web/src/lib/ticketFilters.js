const DEV_JIRA_STATUSES = new Set(['in progress', 'in development']);
const TODO_JIRA_STATUSES = new Set(['to do', 'todo', 'open', 'backlog']);
const LEFT_DEVELOPMENT = new Set(['staging', 'queued', 'develop']);

export const TICKET_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'to_do', label: 'To do' },
  { id: 'in_progress', label: 'In progress' },
  { id: 'staging_queued', label: 'Awaiting staging merge' },
  { id: 'staging', label: 'On staging' },
  { id: 'queued', label: 'Awaiting production' },
  { id: 'develop', label: 'In production' },
  { id: 'conflict', label: 'Conflicts' },
  { id: 'rejected', label: 'Rejected' },
];

function jiraStatusOf(ticket) {
  return (ticket.jiraStatus || '').trim().toLowerCase();
}

/** Tickets still being worked — Jira In Progress / In Development, not yet on staging or production. */
export function isUnderDevelopment(ticket) {
  if (!DEV_JIRA_STATUSES.has(jiraStatusOf(ticket))) return false;
  return !LEFT_DEVELOPMENT.has(ticket.pipelineState);
}

/** Not started yet — Jira To Do / Open / Backlog, and not already on staging or production. */
export function isToDo(ticket) {
  if (!TODO_JIRA_STATUSES.has(jiraStatusOf(ticket))) return false;
  return !LEFT_DEVELOPMENT.has(ticket.pipelineState);
}

export function matchesTicketFilter(ticket, filterId) {
  if (!filterId || filterId === 'all') return true;
  if (filterId === 'in_progress') return isUnderDevelopment(ticket);
  if (filterId === 'to_do') return isToDo(ticket);
  return ticket.pipelineState === filterId;
}

export function filterTickets(tickets, filterId) {
  return tickets.filter((t) => matchesTicketFilter(t, filterId));
}

export function filterLabel(filterId) {
  return TICKET_FILTERS.find((f) => f.id === filterId)?.label ?? 'Tickets';
}
