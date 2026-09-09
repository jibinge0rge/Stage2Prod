import { useTheme } from '../context/ThemeContext';

const OPTIONS = [
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
  { id: 'system', label: 'Auto' },
];

export default function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        padding: 2,
        border: '1px solid var(--dark-divider)',
        borderRadius: 44,
        flexShrink: 0,
      }}
    >
      {OPTIONS.map((opt) => {
        const active = theme === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => setTheme(opt.id)}
            title={`Switch to ${opt.label.toLowerCase()} theme`}
            style={{
              height: 18,
              padding: '0 8px',
              border: 'none',
              borderRadius: 44,
              background: active ? 'rgba(255,255,255,0.16)' : 'transparent',
              color: active ? 'var(--dark-value)' : 'var(--dark-muted)',
              fontSize: 10,
              fontWeight: 500,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
