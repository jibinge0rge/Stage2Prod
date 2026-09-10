import { useState } from 'react';
import styles from '../layout/AppShell.module.css';
import { useApi, postJson } from '../lib/api';
import { StateBadge } from './Badge';
import CustomSelect from './CustomSelect';
import { pipelineStyle, checkStatusColor } from '../lib/styleMaps';

const MERGE_TARGET_LABEL = {
  staging_queued: 'Merge PR into staging',
  queued: 'Merge PR into develop',
};

export default function TicketDrawer({ ticketKey, onClose }) {
  const { data: ticket, loading, refresh } = useApi(`/tickets/${ticketKey}`);
  const { data: health } = useApi('/health');
  const { data: transitionsData } = useApi(`/tickets/${ticketKey}/transitions`);
  const [transitioning, setTransitioning] = useState(false);
  const [transitionError, setTransitionError] = useState(null);
  const [commentText, setCommentText] = useState('');
  const [commenting, setCommenting] = useState(false);
  const [commentError, setCommentError] = useState(null);
  const [merging, setMerging] = useState(false);
  const [mergeError, setMergeError] = useState(null);

  async function handleTransition(name) {
    if (!name) return;
    setTransitioning(true);
    setTransitionError(null);
    try {
      await postJson(`/tickets/${ticketKey}/transition`, { name });
      await refresh();
    } catch (err) {
      setTransitionError(err.message);
    } finally {
      setTransitioning(false);
    }
  }

  async function handleComment() {
    if (!commentText.trim()) return;
    setCommenting(true);
    setCommentError(null);
    try {
      await postJson(`/tickets/${ticketKey}/comment`, { text: commentText });
      setCommentText('');
    } catch (err) {
      setCommentError(err.message);
    } finally {
      setCommenting(false);
    }
  }

  async function handleMerge() {
    setMerging(true);
    setMergeError(null);
    try {
      await postJson(`/tickets/${ticketKey}/merge`, {});
      await refresh();
    } catch (err) {
      setMergeError(err.message);
    } finally {
      setMerging(false);
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

  const jiraUrl = health?.jiraHost ? `https://${health.jiraHost}/browse/${ticket.key}` : null;
  const mergeLabel = MERGE_TARGET_LABEL[ticket.pipelineState];
  const transitionOptions = (transitionsData?.transitions ?? []).map((t) => ({ value: t.name, label: t.name }));

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
              This pull request couldn't be merged cleanly. Resolve the conflict on GitHub, then click Merge
              here again.
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

        <div style={{ border: '1px solid var(--n-border)', borderRadius: 'var(--r-card)', padding: 11, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="eyebrow">Actions</div>

          <div>
            <div style={{ fontSize: 10, color: 'var(--n-muted)', marginBottom: 4 }}>Transition Jira status</div>
            <CustomSelect
              value={null}
              placeholder={transitioning ? 'Transitioning…' : 'Move to…'}
              options={transitionOptions}
              disabled={transitioning || transitionOptions.length === 0}
              onChange={handleTransition}
              title="Transition Jira status"
            />
            {transitionOptions.length === 0 && !transitioning && (
              <div style={{ fontSize: 11, color: 'var(--n-muted)', marginTop: 4 }}>No transitions available.</div>
            )}
            {transitionError && <div style={{ fontSize: 11, color: 'var(--danger)', marginTop: 4 }}>{transitionError}</div>}
          </div>

          <div>
            <div style={{ fontSize: 10, color: 'var(--n-muted)', marginBottom: 4 }}>Comment on Jira</div>
            <textarea
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              placeholder="Add a comment…"
              rows={2}
              style={{
                width: '100%',
                resize: 'vertical',
                padding: '6px 8px',
                border: '1px solid var(--n-border)',
                borderRadius: 'var(--r-input)',
                background: 'var(--n-surface)',
                color: 'var(--n-body)',
                fontSize: 12,
                fontFamily: 'inherit',
              }}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
              <button type="button" className="btn btn-outline" onClick={handleComment} disabled={commenting || !commentText.trim()}>
                {commenting ? 'Posting…' : 'Post comment'}
              </button>
              {commentError && <span style={{ fontSize: 11, color: 'var(--danger)' }}>{commentError}</span>}
            </div>
          </div>

          {mergeLabel && (
            <div>
              <button type="button" className="btn btn-primary" onClick={handleMerge} disabled={merging}>
                {merging ? 'Merging…' : mergeLabel}
              </button>
              {mergeError && <div style={{ fontSize: 11, color: 'var(--danger)', marginTop: 4 }}>{mergeError}</div>}
            </div>
          )}
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
        <a
          href={jiraUrl ?? undefined}
          target="_blank"
          rel="noreferrer"
          className="btn btn-outline"
          aria-disabled={!jiraUrl}
          style={!jiraUrl ? { pointerEvents: 'none', opacity: 0.6 } : undefined}
          title={jiraUrl ? undefined : 'JIRA_HOST not configured'}
        >
          Open in Jira
        </a>
        <div className="spacer" />
        <span style={{ fontSize: 11, color: 'var(--n-muted)' }}>{ticket.updatedAt ? new Date(ticket.updatedAt).toLocaleString() : ''}</span>
      </div>
    </aside>
  );
}
