import { PIPELINE_STATE_STYLES } from './styleMaps.js';

const COLUMNS = [
  { header: 'Ticket', value: (t) => t.key },
  { header: 'Summary', value: (t) => t.summary },
  { header: 'Jira status', value: (t) => t.jiraStatus },
  { header: 'Pipeline', value: (t) => PIPELINE_STATE_STYLES[t.pipelineState]?.label ?? t.pipelineState },
  { header: 'Repo', value: (t) => (t.repo ? `${t.repo.owner}/${t.repo.name}` : '') },
  { header: 'Branch', value: (t) => t.branch },
  { header: 'PR', value: (t) => (t.prNumber ? `#${t.prNumber}` : '') },
  { header: 'Checks', value: (t) => t.checkStatus },
  { header: 'Assignee', value: (t) => t.assignee?.name },
  { header: 'Sprint', value: (t) => t.sprint },
  { header: 'Updated', value: (t) => t.updatedAt },
];

export function csvEscape(value) {
  const s = value == null ? '' : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function ticketsToCsv(tickets) {
  const lines = [COLUMNS.map((c) => csvEscape(c.header)).join(',')];
  for (const t of tickets) {
    lines.push(COLUMNS.map((c) => csvEscape(c.value(t))).join(','));
  }
  return `\uFEFF${lines.join('\n')}\n`;
}

export function downloadFilename(slug, now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  const safe = String(slug || 'tickets')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `tickets-${safe || 'tickets'}-${day}.csv`;
}

export function downloadTicketsCsv(tickets, slug) {
  const csv = ticketsToCsv(tickets);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = downloadFilename(slug);
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
