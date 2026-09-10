export default function KpiTile({ label, value, caption, valueColor, onClick }) {
  const interactive = typeof onClick === 'function';
  return (
    <div
      className="card"
      style={{ padding: '13px 14px', cursor: interactive ? 'pointer' : undefined }}
      onClick={onClick}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
    >
      <div className="eyebrow">{label}</div>
      <div className="stat-value" style={{ marginTop: 5, color: valueColor }}>
        {value}
      </div>
      <div style={{ fontSize: 11, color: 'var(--n-muted)' }}>{caption}</div>
    </div>
  );
}
