export const TICKET_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'staging_queued', label: 'Awaiting staging merge' },
  { id: 'staging', label: 'On staging' },
  { id: 'queued', label: 'Awaiting production' },
  { id: 'conflict', label: 'Conflicts' },
  { id: 'rejected', label: 'Rejected' },
];

export default function FilterChips({ value, onChange }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      {TICKET_FILTERS.map((f) => (
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
