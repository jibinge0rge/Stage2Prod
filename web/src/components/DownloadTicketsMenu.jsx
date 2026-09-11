import { useEffect, useRef, useState } from 'react';
import { PIPELINE_FILTERS, filterTickets } from '../lib/ticketFilters';
import { downloadTicketsCsv } from '../lib/ticketsCsv';

export default function DownloadTicketsMenu({ tickets, currentRows, currentFilter, filterOptions, statusHandlerMap }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    function onDocMouseDown(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    }
    function onKeyDown(e) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const slices = (filterOptions || PIPELINE_FILTERS).map((f) => ({
    id: f.id,
    label: f.label,
    rows: filterTickets(tickets, f.id, statusHandlerMap),
  }));

  function download(rows, slug) {
    if (!rows.length) return;
    const safe = String(slug).replace(/[^a-zA-Z0-9._-]+/g, '_');
    downloadTicketsCsv(rows, safe);
    setOpen(false);
  }

  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      <button
        type="button"
        className="btn btn-outline"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        Download ▾
      </button>
      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            right: 0,
            minWidth: 240,
            maxHeight: 360,
            overflowY: 'auto',
            background: 'var(--n-surface)',
            border: '1px solid var(--n-border)',
            borderRadius: 'var(--r-input)',
            boxShadow: 'var(--shadow-popover)',
            zIndex: 40,
            padding: 4,
            transformOrigin: 'top right',
          }}
        >
          <MenuItem
            label="This view"
            count={currentRows.length}
            hint={currentFilter !== 'all' ? 'current filter and search' : 'current search'}
            disabled={currentRows.length === 0}
            onSelect={() => download(currentRows, currentFilter === 'all' ? 'filtered' : currentFilter)}
          />
          <div style={{ height: 1, background: 'var(--n-hairline)', margin: '4px 6px' }} />
          {slices.map((s) => (
            <MenuItem
              key={s.id}
              label={s.label}
              count={s.rows.length}
              disabled={s.rows.length === 0}
              onSelect={() => download(s.rows, s.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function MenuItem({ label, count, hint, disabled, onSelect }) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onSelect}
      style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: 8,
        width: '100%',
        padding: '6px 8px',
        border: 0,
        borderRadius: 4,
        background: 'transparent',
        color: disabled ? 'var(--n-muted)' : 'var(--n-body)',
        fontSize: 11,
        fontFamily: 'inherit',
        textAlign: 'left',
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
      onMouseEnter={(e) => {
        if (!disabled) e.currentTarget.style.background = 'var(--hover-overlay)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent';
      }}
    >
      <span style={{ flex: 1, minWidth: 0 }}>
        {label}
        {hint ? (
          <span style={{ display: 'block', fontSize: 10, color: 'var(--n-muted)', marginTop: 1 }}>{hint}</span>
        ) : null}
      </span>
      <span style={{ flexShrink: 0, color: 'var(--n-muted)', fontVariantNumeric: 'tabular-nums' }}>{count}</span>
    </button>
  );
}
