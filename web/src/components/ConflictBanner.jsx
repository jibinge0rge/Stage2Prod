import { useNavigate } from 'react-router-dom';

export default function ConflictBanner({ tickets }) {
  const navigate = useNavigate();
  if (!tickets?.length) return null;
  const first = tickets[0];

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        padding: '11px 13px',
        border: '1px solid var(--danger-border)',
        borderLeft: '2px solid var(--danger)',
        borderRadius: 'var(--r-card)',
        background: 'var(--danger-fill)',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--danger-text)' }}>
          {tickets.length} ticket{tickets.length === 1 ? '' : 's'} need{tickets.length === 1 ? 's' : ''} attention
        </div>
        <div style={{ fontSize: 11, color: 'var(--n-body)', marginTop: 3 }}>
          {first.key} — automated merge to <span className="mono">staging</span> failed due to merge conflicts
          with current staging branch. Comment posted to Jira.
        </div>
      </div>
      <button type="button" className="btn btn-danger-outline" onClick={() => navigate('/pipeline?filter=conflict')}>
        Review
      </button>
    </div>
  );
}
