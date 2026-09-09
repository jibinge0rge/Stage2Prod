import { useEffect, useState } from 'react';
import { useApi } from '../lib/api';
import { useRegisterRefresh } from '../lib/useRegisterRefresh';

const MAPPINGS = [
  { status: 'Ready for QA', action: 'Merge feature branch into staging', comment: 'Merged into staging successfully. Ready for validation.' },
  { status: 'In QA', action: 'Merge feature branch into staging', comment: 'Merged into staging successfully. Ready for validation.' },
  { status: 'Approved', action: 'Merge PR into develop (merge commit)', comment: 'Merged into develop and branch deleted.' },
  { status: 'Ready for Release', action: 'Merge PR into develop (merge commit)', comment: 'Merged into develop and branch deleted.' },
  { status: 'Done', action: 'Merge PR into develop, delete remote branch', comment: 'Merged into develop and branch deleted.' },
  { status: 'QA Failed', action: 'Label PR qa-rejected. No revert, no cherry-pick.', comment: 'Feature rejected. Branch remains unmerged into develop.' },
  { status: 'In Development', action: 'No git action', comment: 'Feature rejected. Branch remains unmerged into develop.' },
];

function PolicyRow({ title, detail, value, on }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingTop: 11, borderTop: '1px solid var(--n-hairline)' }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--n-strongest)' }}>{title}</div>
        <div style={{ fontSize: 11, color: 'var(--n-muted)' }}>{detail}</div>
      </div>
      <span
        className="badge"
        style={{ background: on ? 'var(--success-fill)' : 'var(--n-fill-subtle)', color: on ? 'var(--success-text)' : 'var(--n-body)' }}
      >
        {value}
      </span>
    </div>
  );
}

function useCountdown(targetIso) {
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
  if (!targetIso) return '—';
  const seconds = Math.round((new Date(targetIso).getTime() - Date.now()) / 1000);
  if (seconds <= 0) return 'due now';
  return `in ${seconds}s`;
}

export default function RulesPolling() {
  const { data: health, refresh } = useApi('/health', { intervalMs: 15000 });
  useRegisterRefresh(refresh);
  const nextPollLabel = useCountdown(health?.poller?.nextPollAt);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 920 }}>
      <div className="card">
        <div className="card-header">
          <div className="card-title">Jira status to git action</div>
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '170px 1fr 190px',
            gap: 10,
            padding: '8px 14px',
            background: 'var(--n-fill-subtle)',
            borderBottom: '1px solid var(--n-border)',
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: 'var(--n-muted)',
          }}
        >
          <div>Jira status</div>
          <div>Action taken</div>
          <div>Jira comment posted</div>
        </div>
        {MAPPINGS.map((m) => (
          <div
            key={m.status}
            style={{ display: 'grid', gridTemplateColumns: '170px 1fr 190px', gap: 10, padding: '10px 14px', borderBottom: '1px solid var(--n-hairline)', alignItems: 'start' }}
          >
            <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--n-strongest)' }}>{m.status}</div>
            <div style={{ fontSize: 12, color: 'var(--n-body)' }}>{m.action}</div>
            <div style={{ fontSize: 11, color: 'var(--n-muted)' }}>{m.comment}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 12, alignItems: 'stretch' }}>
        <div className="card" style={{ padding: 14, display: 'flex', flexDirection: 'column' }}>
          <div className="card-title">Jira polling</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--n-body)', marginBottom: 4 }}>JQL watched</div>
              <div
                className="mono"
                style={{ padding: '7px 10px', border: '1px solid var(--n-border)', borderRadius: 'var(--r-input)', background: 'var(--n-fill-subtle)', fontSize: 11, color: 'var(--n-body)', overflowX: 'auto', whiteSpace: 'nowrap' }}
              >
                {health?.jiraJql || 'project = PROJ AND status CHANGED AFTER -5m'}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--n-body)', marginBottom: 4 }}>Interval</div>
                <div style={{ padding: '7px 10px', border: '1px solid var(--n-border)', borderRadius: 'var(--r-input)', fontSize: 11, color: 'var(--n-body)' }}>
                  Every {Math.round((health?.poller?.intervalMs ?? 60000) / 1000)} seconds
                </div>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--n-body)', marginBottom: 4 }}>Next poll</div>
                <div style={{ padding: '7px 10px', border: '1px solid var(--n-border)', borderRadius: 'var(--r-input)', fontSize: 11, color: 'var(--n-body)', fontVariantNumeric: 'tabular-nums' }}>
                  {nextPollLabel}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7, paddingTop: 11, borderTop: '1px solid var(--n-hairline)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 11, color: 'var(--n-muted)', flex: 1 }}>Last successful poll</span>
                <span className="mono" style={{ fontSize: 11, color: 'var(--n-body)' }}>
                  {health?.poller?.lastPollAt ? new Date(health.poller.lastPollAt).toISOString().slice(11, 19) + ' UTC' : '—'}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 11, color: 'var(--n-muted)', flex: 1 }}>Cursor (last seen transition)</span>
                <span className="mono" style={{ fontSize: 11, color: 'var(--n-body)' }}>{health?.poller?.cursor || '—'}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 11, color: 'var(--n-muted)', flex: 1 }}>Jira rate limit remaining</span>
                <span style={{ fontSize: 11, color: 'var(--n-body)', fontVariantNumeric: 'tabular-nums' }}>
                  {health?.jira?.rateLimitRemaining ?? '—'}
                </span>
              </div>
            </div>
            <div style={{ fontSize: 11, color: 'var(--n-muted)' }}>
              Cursor is persisted to disk, so a restart replays only transitions newer than the last one handled.
              No inbound port and no public URL required.
            </div>
          </div>
        </div>

        <div className="card" style={{ padding: 14, display: 'flex', flexDirection: 'column' }}>
          <div className="card-title">Merge policy</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 11, marginTop: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--n-strongest)' }}>Merge strategy into develop</div>
                <div style={{ fontSize: 11, color: 'var(--n-muted)' }}>merge commit, never squash</div>
              </div>
              <span className="badge" style={{ background: 'var(--n-fill-subtle)', color: 'var(--n-body)' }}>merge</span>
            </div>
            <PolicyRow title="Require passing status checks" detail="blocks develop merges only" value="on" on />
            <PolicyRow title="Delete branch after develop merge" detail="remote only" value="on" on />
            <PolicyRow title="Label rejected PRs" detail="applies qa-rejected" value="on" on />
          </div>
        </div>
      </div>
    </div>
  );
}
