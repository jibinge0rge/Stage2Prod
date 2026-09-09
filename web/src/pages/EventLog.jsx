import { useState } from 'react';
import { useApi } from '../lib/api';
import { useRegisterRefresh } from '../lib/useRegisterRefresh';
import { EventLogTable } from '../components/EventTable';

const PAGE_SIZE = 50;

export default function EventLog() {
  const [offset, setOffset] = useState(0);
  const { data, refresh } = useApi(`/events?limit=${PAGE_SIZE}&offset=${offset}`, { intervalMs: 15000 });
  useRegisterRefresh(refresh);

  const events = data?.events ?? [];
  const total = data?.total ?? 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <EventLogTable events={events} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--n-muted)' }}>
        <span>
          Showing {events.length ? offset + 1 : 0}–{offset + events.length} of {total}
        </span>
        <div className="spacer" />
        <button
          type="button"
          className="btn btn-outline"
          disabled={offset === 0}
          onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
        >
          Newer
        </button>
        <button
          type="button"
          className="btn btn-outline"
          disabled={offset + PAGE_SIZE >= total}
          onClick={() => setOffset(offset + PAGE_SIZE)}
        >
          Older
        </button>
      </div>
    </div>
  );
}
