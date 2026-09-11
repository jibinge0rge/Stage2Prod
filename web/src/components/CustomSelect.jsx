import { useEffect, useRef, useState } from 'react';

/**
 * A styled dropdown standing in for a native <select>. Native selects
 * can't be restyled once opened — the options popup is drawn by the OS
 * outside the page's CSS, which is why it ignored the app's dark theme
 * entirely. This renders the trigger AND the option list ourselves, so
 * both follow the design tokens in both themes.
 */
export default function CustomSelect({ value, options, onChange, disabled, placeholder, style, title }) {
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

  const opts = options.map((o) => (typeof o === 'string' ? { value: o, label: o } : o));
  const current = opts.find((o) => o.value === value);

  return (
    <div ref={rootRef} style={{ position: 'relative', width: '100%', ...style }}>
      <button
        type="button"
        disabled={disabled}
        title={title}
        onClick={() => setOpen((v) => !v)}
        style={{
          width: '100%',
          height: 26,
          padding: '0 8px',
          border: '1px solid var(--n-border)',
          borderRadius: 'var(--r-input)',
          background: 'var(--n-surface)',
          color: current ? 'var(--n-body)' : 'var(--n-muted)',
          fontSize: 11,
          fontFamily: 'inherit',
          cursor: disabled ? 'not-allowed' : 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 6,
          opacity: disabled ? 0.6 : 1,
        }}
      >
        <span className="truncate" style={{ minWidth: 0, textAlign: 'left' }}>
          {current?.label ?? placeholder ?? 'Select…'}
        </span>
        <span style={{ flexShrink: 0, fontSize: 9, color: 'var(--n-muted)' }}>▾</span>
      </button>

      {open && !disabled && (
        <div
          role="listbox"
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            minWidth: '100%',
            maxHeight: 220,
            overflowY: 'auto',
            background: 'var(--n-surface)',
            border: '1px solid var(--n-border)',
            borderRadius: 'var(--r-input)',
            boxShadow: 'var(--shadow-popover)',
            zIndex: 40,
            padding: 4,
          }}
        >
          {opts.map((o) => {
            const active = o.value === value;
            return (
              <div
                key={o.value === '' ? '__empty__' : o.value}
                role="option"
                aria-selected={active}
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
                style={{
                  padding: '6px 8px',
                  borderRadius: 4,
                  fontSize: 11,
                  color: active ? 'var(--brand-hover)' : 'var(--n-body)',
                  background: active ? 'var(--brand-fill-selected)' : 'transparent',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
                onMouseEnter={(e) => {
                  if (!active) e.currentTarget.style.background = 'var(--hover-overlay)';
                }}
                onMouseLeave={(e) => {
                  if (!active) e.currentTarget.style.background = 'transparent';
                }}
              >
                {o.label}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
