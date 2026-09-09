import { OutcomeBadge } from './Badge';
import { outcomeStyle } from '../lib/styleMaps';

function formatTimestamp(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · ${d.toISOString().slice(11, 19)}`;
}

export function RecentEventsList({ events }) {
  if (!events?.length) return <div className="empty-state">No automation events yet.</div>;
  return (
    <div>
      {events.map((e) => (
        <div
          key={e.id}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '9px 14px',
            borderBottom: '1px solid var(--n-hairline)',
          }}
        >
          <span className="mono" style={{ fontSize: 11, color: 'var(--n-muted)', flexShrink: 0 }}>
            {e.timestamp.slice(11, 19)}
          </span>
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--n-body)', flexShrink: 0, width: 74 }}>
            {e.ticketKey || '—'}
          </span>
          <span className="truncate" style={{ flex: 1, minWidth: 0, fontSize: 12, color: 'var(--n-body)' }}>
            {e.title}
          </span>
          <OutcomeBadge outcome={e.outcome} styleMap={outcomeStyle} />
        </div>
      ))}
    </div>
  );
}

const LOG_COLUMNS = '150px 92px 150px minmax(220px,1fr) 96px';

export function EventLogTable({ events }) {
  return (
    <div className="card table-wrap">
      <div className="table-head-row" style={{ gridTemplateColumns: LOG_COLUMNS, minWidth: 760 }}>
        <div>Timestamp</div>
        <div>Ticket</div>
        <div>Trigger</div>
        <div>Action</div>
        <div>Outcome</div>
      </div>
      {events.length === 0 ? (
        <div className="empty-state">No events recorded yet.</div>
      ) : (
        events.map((e) => (
          <div key={e.id} className="table-row" style={{ gridTemplateColumns: LOG_COLUMNS, minWidth: 760, height: 36 }}>
            <div className="mono" style={{ fontSize: 11, color: 'var(--n-muted)' }}>
              {formatTimestamp(e.timestamp)}
            </div>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--n-strongest)' }}>{e.ticketKey || '—'}</div>
            <div style={{ fontSize: 11, color: 'var(--n-muted)' }}>{e.trigger}</div>
            <div className="truncate" style={{ fontSize: 12, color: 'var(--n-body)' }}>
              {e.title}
              {e.detail ? ` — ${e.detail}` : ''}
            </div>
            <div>
              <OutcomeBadge outcome={e.outcome} styleMap={outcomeStyle} />
            </div>
          </div>
        ))
      )}
    </div>
  );
}
