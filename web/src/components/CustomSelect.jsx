import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const LIST_MAX_HEIGHT = 240;

/**
 * A styled dropdown standing in for a native <select>. Native selects
 * can't be restyled once opened — the options popup is drawn by the OS
 * outside the page's CSS, which is why it ignored the app's dark theme
 * entirely. This renders the trigger AND the option list ourselves, so
 * both follow the design tokens in both themes.
 *
 * The list is portaled to document.body so overflow:hidden parents
 * (scrollable connect-repo lists, cards, etc.) cannot clip it.
 */
export default function CustomSelect({ value, options, onChange, disabled, placeholder, style, title }) {
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState(null);
  const rootRef = useRef(null);
  const menuRef = useRef(null);

  useLayoutEffect(() => {
    if (!open || disabled) {
      setMenuStyle(null);
      return undefined;
    }

    function place() {
      const trigger = rootRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom - 8;
      const spaceAbove = rect.top - 8;
      const openUp = spaceBelow < Math.min(LIST_MAX_HEIGHT, 160) && spaceAbove > spaceBelow;
      const maxHeight = Math.max(120, Math.min(LIST_MAX_HEIGHT, openUp ? spaceAbove : spaceBelow));
      const width = Math.max(rect.width, 140);

      setMenuStyle({
        position: 'fixed',
        left: Math.min(rect.left, window.innerWidth - width - 8),
        width,
        maxHeight,
        zIndex: 200,
        ...(openUp
          ? { bottom: window.innerHeight - rect.top + 4, top: 'auto' }
          : { top: rect.bottom + 4, bottom: 'auto' }),
      });
    }

    place();
    window.addEventListener('resize', place);
    // Capture scroll from any scrollable ancestor (connect-repo list, drawer, …).
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, disabled, options]);

  useEffect(() => {
    if (!open) return undefined;
    function onDocMouseDown(e) {
      const inTrigger = rootRef.current?.contains(e.target);
      const inMenu = menuRef.current?.contains(e.target);
      if (!inTrigger && !inMenu) setOpen(false);
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

  const menu =
    open && !disabled && menuStyle
      ? createPortal(
          <div
            ref={menuRef}
            role="listbox"
            style={{
              ...menuStyle,
              overflowY: 'auto',
              background: 'var(--n-surface)',
              border: '1px solid var(--n-border)',
              borderRadius: 'var(--r-input)',
              boxShadow: 'var(--shadow-popover)',
              padding: 4,
            }}
          >
            {opts.length === 0 ? (
              <div style={{ padding: '8px', fontSize: 11, color: 'var(--n-muted)' }}>No options</div>
            ) : (
              opts.map((o) => {
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
                      padding: '7px 8px',
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
              })
            )}
          </div>,
          document.body
        )
      : null;

  return (
    <div ref={rootRef} style={{ position: 'relative', width: '100%', ...style }}>
      <button
        type="button"
        disabled={disabled}
        title={title}
        aria-expanded={open}
        aria-haspopup="listbox"
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
      {menu}
    </div>
  );
}
