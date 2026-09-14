import { useCallback, useEffect } from 'react';
import styles from '../layout/AppShell.module.css';
import { useApi } from '../lib/api';
import { useRegisterRefresh } from '../lib/useRegisterRefresh';
import { useAppContext } from '../context/AppContext';
import { StateBadge } from './Badge';
import { pipelineStyle } from '../lib/styleMaps';

function shortSha(sha) {
  return sha ? sha.slice(0, 7) : '—';
}

function formatCutDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function CutDrawer({ cut, onClose }) {
  const { openTicket } = useAppContext();
  const path = cut ? `/repos/${cut.owner}/${cut.name}/cuts/${cut.id}` : null;
  const { data, loading, error, refresh } = useApi(path, { intervalMs: 30000 });
  useRegisterRefresh(refresh);

  const handleTicket = useCallback(
    (key) => {
      openTicket(key);
    },
    [openTicket]
  );

  useEffect(() => {
    if (!cut) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cut, onClose]);

  if (loading && !data) {
    return (
      <aside className={styles.drawerAside}>
        <div className="empty-state">Loading cut…</div>
      </aside>
    );
  }

  const detail = data?.cut;
  if (error || !detail) {
    return (
      <aside className={styles.drawerAside}>
        <div style={{ padding: '13px 16px', borderBottom: '1px solid var(--n-border)', display: 'flex', justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-plain" style={{ width: 24, height: 24, padding: 0, fontSize: 14 }} onClick={onClose}>
            ×
          </button>
        </div>
        <div className="empty-state">{error?.message || 'Cut not found.'}</div>
      </aside>
    );
  }

  const tickets = detail.tickets || [];
  const githubTree =
    cut.owner && cut.name && detail.branchName
      ? `https://github.com/${cut.owner}/${cut.name}/tree/${encodeURIComponent(detail.branchName).replace(/%2F/g, '/')}`
      : null;

  return (
    <aside className={styles.drawerAside}>
      <div style={{ padding: '13px 16px', borderBottom: '1px solid var(--n-border)', display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 11, color: 'var(--n-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 }}>
            Production cut
          </div>
          <div className="mono" style={{ fontSize: 14, fontWeight: 600, color: 'var(--n-strongest)', marginTop: 4 }}>
            {detail.branchName}
          </div>
          <div style={{ fontSize: 11, color: 'var(--n-muted)', marginTop: 4 }}>
            {shortSha(detail.sha)}
            {detail.createdAt ? ` · ${formatCutDate(detail.createdAt)}` : ''}
          </div>
        </div>
        <button type="button" className="btn btn-plain" style={{ width: 24, height: 24, padding: 0, fontSize: 14 }} onClick={onClose}>
          ×
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ fontSize: 11, color: 'var(--n-muted)' }}>
          Tickets that landed from staging in this cut
          {githubTree ? (
            <>
              {' · '}
              <a href={githubTree} target="_blank" rel="noreferrer">
                View branch
              </a>
            </>
          ) : null}
        </div>

        {tickets.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--n-muted)' }}>No tracked tickets in this cut.</div>
        ) : (
          tickets.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => handleTicket(t.key)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                width: '100%',
                padding: '9px 10px',
                border: '1px solid var(--n-border)',
                borderRadius: 'var(--r-card)',
                background: 'var(--n-surface)',
                cursor: 'pointer',
                textAlign: 'left',
                font: 'inherit',
                color: 'inherit',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--n-strongest)' }}>{t.key}</span>
                {t.pipelineState ? <StateBadge state={t.pipelineState} styleMap={pipelineStyle} /> : null}
              </div>
              <div className="truncate" style={{ fontSize: 11, color: 'var(--n-body)' }}>
                {t.summary || '—'}
              </div>
            </button>
          ))
        )}
      </div>
    </aside>
  );
}

export { formatCutDate, shortSha };
