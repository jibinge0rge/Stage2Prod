/** Fixed lifecycle stages — filters only show these, not every Jira status. */
export const PIPELINE_STAGES = [
  { id: 'open', label: 'Open' },
  { id: 'in_progress', label: 'In progress' },
  { id: 'in_qa', label: 'In QA' },
  { id: 'ready_for_release', label: 'Ready for release' },
  { id: 'done', label: 'Done' },
];

export const PIPELINE_FILTERS = [
  { id: 'all', label: 'All', kind: 'pipeline' },
  ...PIPELINE_STAGES.map((s) => ({ ...s, kind: 'stage' })),
  { id: 'conflict', label: 'Conflicts', kind: 'pipeline' },
];

/** @deprecated Prefer PIPELINE_FILTERS / buildTicketFilters. */
export const TICKET_FILTERS = PIPELINE_FILTERS;

function normalizeMap(statusHandlerMap) {
  if (!statusHandlerMap || typeof statusHandlerMap !== 'object') return null;
  // New shape: { open: { jiraStatus, match }, ... }
  if (statusHandlerMap.open || statusHandlerMap.in_progress || statusHandlerMap.in_qa) {
    return statusHandlerMap;
  }
  return null;
}

function matchListForStage(stageId, statusHandlerMap) {
  const map = normalizeMap(statusHandlerMap);
  const entry = map?.[stageId];
  if (!entry) {
    const defaults = {
      open: ['Open', 'To Do', 'Todo', 'Backlog'],
      in_progress: ['In Progress', 'In Development'],
      in_qa: ['In QA'],
      ready_for_release: ['Ready for Release', 'Approved'],
      done: ['Done'],
    };
    return defaults[stageId] || [];
  }
  if (typeof entry === 'string') return [entry];
  const names = [...(entry.match || [])];
  if (entry.jiraStatus && !names.some((n) => n.toLowerCase() === entry.jiraStatus.toLowerCase())) {
    names.unshift(entry.jiraStatus);
  }
  return names;
}

export function stageForTicket(ticket, statusHandlerMap = null) {
  if (ticket.pipelineState === 'conflict') return 'conflict';
  const status = (ticket.jiraStatus || '').trim().toLowerCase();
  if (!status) return null;
  for (const stage of PIPELINE_STAGES) {
    const names = matchListForStage(stage.id, statusHandlerMap).map((n) => n.toLowerCase());
    if (names.includes(status)) return stage.id;
  }
  return null;
}

/** Tickets still being worked — In progress stage, not yet past staging. */
export function isUnderDevelopment(ticket, statusHandlerMap = null) {
  return stageForTicket(ticket, statusHandlerMap) === 'in_progress';
}

/** @deprecated */
export function isToDo(ticket, statusHandlerMap = null) {
  return stageForTicket(ticket, statusHandlerMap) === 'open';
}

export function buildTicketFilters(tickets = [], { statusHandlerMap = null, selectedFilter = 'all' } = {}) {
  const hasConflict = tickets.some((t) => t.pipelineState === 'conflict');
  return PIPELINE_FILTERS.filter(
    (f) => f.id !== 'conflict' || hasConflict || selectedFilter === 'conflict'
  );
}

export function matchesTicketFilter(ticket, filterId, statusHandlerMap = null) {
  if (!filterId || filterId === 'all') return true;
  if (filterId === 'conflict') return ticket.pipelineState === 'conflict';
  // Legacy pipeline-state URLs
  if (['unmerged', 'staging_queued', 'staging', 'queued', 'develop', 'rejected'].includes(filterId)) {
    return ticket.pipelineState === filterId;
  }
  if (filterId === 'in_progress') return isUnderDevelopment(ticket, statusHandlerMap);
  if (filterId === 'to_do') return isToDo(ticket, statusHandlerMap);
  return stageForTicket(ticket, statusHandlerMap) === filterId;
}

export function filterTickets(tickets, filterId, statusHandlerMap = null) {
  return tickets.filter((t) => matchesTicketFilter(t, filterId, statusHandlerMap));
}

export function filterLabel(filterId, filters = PIPELINE_FILTERS) {
  if (!filterId || filterId === 'all') return 'Tickets';
  return filters.find((f) => f.id === filterId)?.label ?? filterId;
}
