import { pipelineStyle } from './styleMaps';

export const EMPTY_COLUMN_FILTERS = {
  ticket: '',
  summary: '',
  assignee: '',
  repo: '',
  branch: '',
  jiraStatus: '',
  pipelineState: '',
};

export function hasActiveColumnFilters(filters) {
  return Object.values(filters || {}).some((v) => String(v || '').trim());
}

function includes(haystack, needle) {
  if (!needle) return true;
  return String(haystack || '')
    .toLowerCase()
    .includes(needle);
}

/** Case-insensitive contains match; all non-empty column filters must pass (AND). */
export function matchesColumnFilters(ticket, filters = EMPTY_COLUMN_FILTERS) {
  const f = {
    ticket: (filters.ticket || '').trim().toLowerCase(),
    summary: (filters.summary || '').trim().toLowerCase(),
    assignee: (filters.assignee || '').trim().toLowerCase(),
    repo: (filters.repo || '').trim().toLowerCase(),
    branch: (filters.branch || '').trim().toLowerCase(),
    jiraStatus: (filters.jiraStatus || '').trim().toLowerCase(),
    pipelineState: (filters.pipelineState || '').trim().toLowerCase(),
  };

  if (!includes(ticket.key, f.ticket)) return false;
  if (!includes(ticket.summary, f.summary)) return false;

  if (f.assignee) {
    const name = ticket.assignee?.name || 'Unassigned';
    if (!includes(name, f.assignee)) return false;
  }

  if (f.repo) {
    const repoLabel = ticket.repo ? `${ticket.repo.owner}/${ticket.repo.name}` : '';
    if (!includes(repoLabel, f.repo)) return false;
  }

  if (!includes(ticket.branch, f.branch)) return false;
  if (!includes(ticket.jiraStatus, f.jiraStatus)) return false;

  if (f.pipelineState) {
    const state = ticket.pipelineState || '';
    const label = pipelineStyle(state).label || '';
    if (!includes(state, f.pipelineState) && !includes(label, f.pipelineState)) return false;
  }

  return true;
}
