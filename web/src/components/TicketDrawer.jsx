import { useState } from 'react';
import styles from '../layout/AppShell.module.css';
import { useApi } from '../lib/api';
import { StateBadge } from './Badge';
import { pipelineStyle, checkStatusColor } from '../lib/styleMaps';

function primaryActionLabel(state) {
  if (state === 'conflict') return 'Retry merge to staging';
  if (state === 'queued') return 'Merge into develop';
  if (state === 'rejected') return 'Clear qa-rejected';
  return 'Re-run merge';
}

export default function TicketDrawer({ ticketKey, onClose }) {
  const { data: ticket, loading, refresh } = useApi(`/tickets/${ticketKey}`);
  const [retrying, setRetrying] = useState(false);

  async function handlePrimaryAction() {
    setRetrying(true);
    try {
      // No manual-retry endpoint exists in the current API — this
      // re-checks the ticket's live state rather than silently no-op'ing.
      await refresh();
    } finally {
      setRetrying(false);
    }
  }

  if (loading && !ticket) {
    return (
      <aside className={styles.drawerAside}>
        <div className="empty-state">Loading ticket…</div>
      </aside>
    );
  }
  if (!ticket) {
    return (
      <aside className={styles.drawerAside}>
        <div className="empty-state">Ticket not found.</div>
      </aside>
    );
  }

  const jiraUrl = null; // no JIRA_HOST exposed to the frontend; "Open in Jira" is disabled without it.

  return (
    <aside className={styles.drawerAside}>
      <div style={{ padding: '13px 16px', borderBottom: '1px solid var(--n-border)', display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--n-strongest)' }}>{ticket.key}</span>
            <StateBadge state={ticket.pipelineState} styleMap={pipelineStyle} />
          </div>
          <div style={{ fontSize: 12, color: 'var(--n-body)', marginTop: 4 }}>{ticket.summary}</div>
        </div>
        <button type="button" className="btn btn-plain" style={{ width: 24, height: 24, padding: 0, fontSize: 14 }} onClick={onClose}>
          ×
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {ticket.pipelineState === 'conflict' && (
          <div style={{ padding: '11px 12px', border: '1px solid var(--danger-border)', borderRadius: 'var(--r-card)', background: 'var(--danger-fill)' }}>
            <div className="eyebrow" style={{ color: 'var(--danger-text)' }}>Comment posted to Jira</div>
            <div style={{ fontSize: 12, color: 'var(--n-body)', marginTop: 6 }}>
              Automated merge to staging failed due to merge conflicts with current staging branch. Please resolve locally.
            </div>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div style={{ border: '1px solid var(--n-border)', borderRadius: 'var(--r-card)', padding: 11 }}>
            <div className="eyebrow">Jira</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 9 }}>
              <div>
                <div style={{ fontSize: 10, color: 'var(--n-muted)' }}>Status</div>
                <div style={{ fontSize: 12, color: 'var(--n-strongest)', fontWeight: 500 }}>{ticket.jiraStatus}</div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: 'var(--n-muted)' }}>Assignee</div>
                <div style={{ fontSize: 12, color: 'var(--n-body)' }}>{ticket.assignee?.name || 'Unassigned'}</div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: 'var(--n-muted)' }}>Sprint</div>
                <div style={{ fontSize: 12, color: 'var(--n-body)' }}>{ticket.sprint || '—'}</div>
              </div>
            </div>
          </div>
          <div style={{ border: '1px solid var(--n-border)', borderRadius: 'var(--r-card)', padding: 11 }}>
            <div className="eyebrow">GitHub</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 9 }}>
              <div>
                <div style={{ fontSize: 10, color: 'var(--n-muted)' }}>Repository</div>
                <div className="mono truncate" style={{ fontSize: 11, color: 'var(--n-strongest)' }}>
                  {ticket.repo ? `${ticket.repo.owner}/${ticket.repo.name}` : 'not yet resolved'}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: 'var(--n-muted)' }}>Head branch</div>
                <div className="mono truncate" style={{ fontSize: 11, color: 'var(--n-strongest)' }}>{ticket.branch || '—'}</div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: 'var(--n-muted)' }}>Pull request</div>
                <div style={{ fontSize: 12, color: 'var(--brand)' }}>
                  {ticket.prNumber ? `#${ticket.prNumber} → ${ticket.repo?.productionBranch ?? 'develop'}` : '—'}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: 'var(--n-muted)' }}>Status checks</div>
                <div style={{ fontSize: 12, color: checkStatusColor(ticket.checkStatus) }}>{ticket.checkStatus || '—'}</div>
              </div>
            </div>
          </div>
        </div>

        <div>
          <div className="eyebrow" style={{ marginBottom: 9 }}>Orchestration timeline</div>
          {(ticket.timeline || []).length === 0 ? (
            <div style={{ fontSize: 11, color: 'var(--n-muted)' }}>No events recorded for this ticket yet.</div>
          ) : (
            ticket.timeline.map((ev, i) => (
              <div key={i} style={{ display: 'flex', gap: 10, paddingBottom: 12 }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0, paddingTop: 3 }}>
                  <span className="dot" style={{ background: 'var(--brand)' }} />
                  {i < ticket.timeline.length - 1 && <span style={{ flex: 1, width: 1, background: 'var(--n-border)', marginTop: 3 }} />}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: 'var(--n-strongest)', fontWeight: 500 }}>{ev.title}</div>
                  {ev.detail && <div style={{ fontSize: 11, color: 'var(--n-muted)', marginTop: 2 }}>{ev.detail}</div>}
                  <div className="mono" style={{ fontSize: 10, color: 'var(--n-muted)', marginTop: 3 }}>{ev.timestamp}</div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div style={{ padding: '12px 16px', borderTop: '1px solid var(--n-border)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <button type="button" className="btn btn-primary" onClick={handlePrimaryAction} disabled={retrying}>
          {retrying ? 'Checking…' : primaryActionLabel(ticket.pipelineState)}
        </button>
        <button type="button" className="btn btn-outline" disabled={!jiraUrl} title={jiraUrl ? undefined : 'JIRA_HOST not exposed to the frontend'}>
          Open in Jira
        </button>
        <div className="spacer" />
        <span style={{ fontSize: 11, color: 'var(--n-muted)' }}>{ticket.updatedAt ? new Date(ticket.updatedAt).toLocaleString() : ''}</span>
      </div>
    </aside>
  );
}
