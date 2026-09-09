export default function KpiTile({ label, value, caption, valueColor }) {
  return (
    <div className="card" style={{ padding: '13px 14px' }}>
      <div className="eyebrow">{label}</div>
      <div className="stat-value" style={{ marginTop: 5, color: valueColor }}>
        {value}
      </div>
      <div style={{ fontSize: 11, color: 'var(--n-muted)' }}>{caption}</div>
    </div>
  );
}
