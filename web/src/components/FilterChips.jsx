import { TICKET_FILTERS } from '../lib/ticketFilters';

export { TICKET_FILTERS };

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
