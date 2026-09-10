export const TICKET_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'in_progress', label: 'In progress' },
  { id: 'staging_queued', label: 'Awaiting staging merge' },
  { id: 'staging', label: 'On staging' },
  { id: 'queued', label: 'Awaiting production' },
  { id: 'conflict', label: 'Conflicts' },
  { id: 'rejected', label: 'Rejected' },
];

export default function FilterChips({ value, onChange, tickets = [] }) {
  const hasRejected = tickets.some((t) => t.pipelineState === 'rejected');
  const filters = TICKET_FILTERS.filter((f) => f.id !== 'rejected' || hasRejected || value === 'rejected');

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      {filters.map((f) => (
        <button
          key={f.id}
          type="button"
          className={`chip ${value === f.id ? 'active' : ''}`}
          onClick={() => onChange(f.id)}
        >
          {f.label}
        </button>
      ))}
    </div>
  );
}
