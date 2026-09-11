import { buildTicketFilters } from '../lib/ticketFilters';

export default function FilterChips({ value, onChange, tickets = [], statusHandlerMap = null }) {
  const filters = buildTicketFilters(tickets, { statusHandlerMap, selectedFilter: value });

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
