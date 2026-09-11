import { useEffect, useMemo, useState } from 'react';
import styles from '../layout/AppShell.module.css';
import { useApi, postJson } from '../lib/api';
import { StateBadge } from './Badge';
import CustomSelect from './CustomSelect';
import { pipelineStyle, checkStatusColor } from '../lib/styleMaps';
import { defaultBranchName } from '../lib/branchName';

function PathStep({ n, title, hint, done, children }) {
  return (
    <div style={{ display: 'flex', gap: 10 }}>
      <div
        style={{
          width: 20,
          height: 20,
          borderRadius: 10,
          flexShrink: 0,
          marginTop: 1,
          background: done ? 'var(--success-fill)' : 'var(--n-fill-subtle)',
          color: done ? 'var(--success-text)' : 'var(--n-muted)',
          fontSize: 10,
          fontWeight: 600,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {done ? '✓' : n}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--n-strongest)' }}>{title}</div>
        {hint ? <div style={{ fontSize: 11, color: 'var(--n-muted)', marginTop: 2 }}>{hint}</div> : null}
        {children ? <div style={{ marginTop: 8 }}>{children}</div> : null}
      </div>
    </div>
  );
}

function pullOptionValue(p) {
  return `${p.repo.owner}/${p.repo.name}#${p.number}`;
}

function parsePullOption(value) {
  const hash = value.lastIndexOf('#');
  const repo = value.slice(0, hash);
  const slash = repo.indexOf('/');
  return {
    owner: repo.slice(0, slash),
    name: repo.slice(slash + 1),
    prNumber: Number(value.slice(hash + 1)),
  };
}

function LinkPrForm({ ticketKey, ticket, pulls, onLinked }) {
  const [selected, setSelected] = useState(null);
  const [typed, setTyped] = useState('');
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState(null);

  const options = useMemo(
    () =>
      pulls.map((p) => ({
        value: pullOptionValue(p),
        label: `#${p.number} ${p.title} · ${p.headRef} → ${p.baseRef}`,
      })),
    [pulls]
  );

  async function handleLink() {
    let body = null;
    if (selected) body = parsePullOption(selected);
    else if (typed.trim()) {
      const prNumber = Number(typed.trim().replace(/^#/, ''));
      body = {
        prNumber,
        owner: ticket.repo?.owner,
        name: ticket.repo?.name,
      };
    }
    if (!body) return;
    setLinking(true);
    setError(null);
    try {
      await postJson(`/tickets/${ticketKey}/pr/link`, body);
      setSelected(null);
      setTyped('');
      await onLinked();
    } catch (err) {
      setError(err.message);
    } finally {
      setLinking(false);
    }
  }

  const canSubmit = Boolean(selected || typed.trim());

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
      <div style={{ fontSize: 11, color: 'var(--n-muted)' }}>
        Branch or title doesn't include this ticket key? Attach an existing PR.
      </div>
      {options.length > 0 && (
        <CustomSelect
          value={selected}
          placeholder="Choose an open PR…"
          options={options}
          disabled={linking}
          onChange={setSelected}
          title="Open pull requests"
        />
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <input
          className="mono"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder="#18"
          disabled={linking}
          style={{
            width: 72,
            height: 26,
            padding: '0 8px',
            border: '1px solid var(--n-border)',
            borderRadius: 'var(--r-input)',
            background: 'var(--n-surface)',
            color: 'var(--n-body)',
            fontSize: 11,
          }}
        />
        <button type="button" className="btn btn-outline" onClick={handleLink} disabled={linking || !canSubmit}>
          {linking ? 'Linking…' : 'Link PR'}
        </button>
      </div>
      {error && <div style={{ fontSize: 11, color: 'var(--danger)' }}>{error}</div>}
    </div>
  );
}

export default function TicketDrawer({ ticketKey, onClose }) {
  const { data: ticket, loading, refresh } = useApi(`/tickets/${ticketKey}`, { intervalMs: 15000 });
  const { data: health } = useApi('/health');
  const { data: transitionsData, refresh: refreshTransitions } = useApi(`/tickets/${ticketKey}/transitions`);
  const { data: pullsData, refresh: refreshPulls } = useApi(`/tickets/${ticketKey}/pulls`);
  const [transitioning, setTransitioning] = useState(false);
  const [transitionError, setTransitionError] = useState(null);
  const [commentText, setCommentText] = useState('');
  const [commenting, setCommenting] = useState(false);
  const [commentError, setCommentError] = useState(null);
  const [merging, setMerging] = useState(false);
  const [mergeError, setMergeError] = useState(null);
  const [branchName, setBranchName] = useState('');
  const [creatingBranch, setCreatingBranch] = useState(false);
  const [branchError, setBranchError] = useState(null);
  const [openingPr, setOpeningPr] = useState(null); // 'staging' | 'production' | null
  const [prError, setPrError] = useState(null);
  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState(null);

  useEffect(() => {
    if (!ticket) return;
    setBranchName(ticket.branch || defaultBranchName(ticket.key, ticket.summary));
    setBranchError(null);
  }, [ticket?.key, ticket?.branch, ticket?.summary]);

  async function refreshTicket() {
    await refresh();
    await refreshTransitions();
    await refreshPulls();
  }

  async function handleTransition(name) {
    if (!name) return;
    setTransitioning(true);
    setTransitionError(null);
    try {
      await postJson(`/tickets/${ticketKey}/transition`, { name });
      await refreshTicket();
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

  async function handleCreateBranch() {
    if (!branchName.trim()) return;
    setCreatingBranch(true);
    setBranchError(null);
    try {
      await postJson(`/tickets/${ticketKey}/branch`, { name: branchName.trim() });
      await refreshTicket();
    } catch (err) {
      setBranchError(err.message);
    } finally {
      setCreatingBranch(false);
    }
  }

  async function handleOpenPr(target) {
    setOpeningPr(target);
    setPrError(null);
    try {
      await postJson(`/tickets/${ticketKey}/pr`, { target });
      await refreshTicket();
    } catch (err) {
      setPrError(err.message);
    } finally {
      setOpeningPr(null);
    }
  }

  async function handleClosePr() {
    setClosing(true);
    setCloseError(null);
    try {
      await postJson(`/tickets/${ticketKey}/pr/close`, {});
      await refreshTicket();
    } catch (err) {
      setCloseError(err.message);
    } finally {
      setClosing(false);
    }
  }

  async function handleMerge() {
    setMerging(true);
    setMergeError(null);
    try {
      await postJson(`/tickets/${ticketKey}/merge`, {});
    } catch (err) {
      setMergeError(err.message);
    } finally {
      await refreshTicket();
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
  const productionLabel = ticket.repo?.productionBranch ?? 'production';
  const stagingLabel = ticket.repo?.stagingBranch ?? 'staging';
  const state = ticket.pipelineState;
  const hasBranch = Boolean(ticket.branch);
  const canResolveRepo = Boolean(ticket.repo) || (health?.watchedRepos?.length === 1);
  const prTargetBranch =
    state === 'staging_queued' || state === 'staging' ? stagingLabel : productionLabel;
  const transitionOptions = (transitionsData?.transitions ?? []).map((t) => ({ value: t.name, label: t.name }));
  const lastFailure =
    state === 'conflict'
      ? [...(ticket.timeline || [])].reverse().find((ev) => ev.title === 'Merge failed')
      : null;

  const onOrPastStaging = ['staging', 'queued', 'develop'].includes(state);
  const onOrPastProduction = state === 'develop';
  const stagingPrOpen = state === 'staging_queued';
  const productionPrOpen = state === 'queued';
  const hasStagingChanges = (ticket.aheadOfStaging ?? 0) > 0;
  const hasProductionChanges = (ticket.aheadOfProduction ?? 0) > 0;
  const canOpenStagingPr =
    hasBranch && (state === 'unmerged' || state === 'rejected') && hasStagingChanges;
  const canOpenProductionPr = hasBranch && state === 'staging' && hasProductionChanges;
  let stagingPrHint = `Opens a pull request. Merge it onto ${stagingLabel} when you're ready — that moves Jira to In QA.`;
  if (!hasBranch) stagingPrHint = 'Create a branch first, or link an existing PR if its name does not include this ticket key.';
  else if (stagingPrOpen) stagingPrHint = `PR already open into ${stagingLabel}. Merge (QA can approve+merge if they didn't open it), or close it to go back.`;
  else if (onOrPastStaging) stagingPrHint = `Already on ${stagingLabel}.`;
  else if (!hasStagingChanges) {
    stagingPrHint = `No changes compared to ${stagingLabel} yet — push commits to this branch first.`;
  }

  let productionPrHint = `After QA, open a PR into ${productionLabel}, then merge it. Merging marks the ticket Done in Jira.`;
  if (!onOrPastStaging && !productionPrOpen) {
    productionPrHint = `Send this to ${stagingLabel} and get QA approval first.`;
  } else if (productionPrOpen) {
    productionPrHint = `PR already open into ${productionLabel}. Merge to ship (approves first if you're not the author), or close it to stay on ${stagingLabel}.`;
  } else if (onOrPastProduction) {
    productionPrHint = `Already merged to ${productionLabel}.`;
  } else if (!hasProductionChanges) {
    productionPrHint = `No changes compared to ${productionLabel} — nothing new to PR.`;
  }

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
        {state === 'conflict' && (
          <div style={{ padding: '11px 12px', border: '1px solid var(--danger-border)', borderRadius: 'var(--r-card)', background: 'var(--danger-fill)' }}>
            <div className="eyebrow" style={{ color: 'var(--danger-text)' }}>Last merge attempt failed</div>
            <div style={{ fontSize: 12, color: 'var(--n-body)', marginTop: 6 }}>
              {lastFailure?.detail || "This pull request couldn't be merged cleanly."} If the PR still exists
              and is fixable on GitHub, click Retry merge below. If it's gone or was closed, retrying won't
              help — recreate the branch and open a fresh PR instead.
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
                {ticket.prNumber ? (
                  <div style={{ fontSize: 12, color: 'var(--brand)' }}>
                    #{ticket.prNumber} → {prTargetBranch}
                  </div>
                ) : (
                  <LinkPrForm
                    ticketKey={ticketKey}
                    ticket={ticket}
                    pulls={pullsData?.pulls ?? []}
                    onLinked={refreshTicket}
                  />
                )}
              </div>
              <div>
                <div style={{ fontSize: 10, color: 'var(--n-muted)' }}>Status checks</div>
                <div style={{ fontSize: 12, color: checkStatusColor(ticket.checkStatus) }}>{ticket.checkStatus || '—'}</div>
              </div>
            </div>
          </div>
        </div>

        <div style={{ border: '1px solid var(--n-border)', borderRadius: 'var(--r-card)', padding: 11, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <div className="eyebrow">Path to production</div>
            <div style={{ fontSize: 11, color: 'var(--n-muted)', marginTop: 4 }}>
              Branch from {productionLabel} → work → staging (QA) → production
            </div>
          </div>

          <PathStep
            n="1"
            title={`Create a branch from ${productionLabel}`}
            hint={hasBranch ? `Already exists: ${ticket.branch}` : 'Cut a feature branch from production. Jira moves to In Progress.'}
            done={hasBranch}
          >
            <input
              className="mono"
              value={branchName}
              onChange={(e) => setBranchName(e.target.value)}
              placeholder={`feat/${ticket.key}`}
              disabled={creatingBranch || hasBranch || !canResolveRepo}
              style={{
                width: '100%',
                height: 28,
                padding: '0 8px',
                border: '1px solid var(--n-border)',
                borderRadius: 'var(--r-input)',
                background: 'var(--n-surface)',
                color: 'var(--n-body)',
                fontSize: 11,
                opacity: hasBranch ? 0.65 : 1,
              }}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleCreateBranch}
                disabled={creatingBranch || hasBranch || !canResolveRepo || !branchName.trim()}
              >
                {creatingBranch ? 'Creating…' : hasBranch ? 'Already exists' : `Create from ${productionLabel}`}
              </button>
            </div>
            {!canResolveRepo && !hasBranch && (
              <div style={{ fontSize: 11, color: 'var(--n-muted)', marginTop: 4 }}>
                Set a Jira project key on the matching watched repo (or watch exactly one repo) so this
                ticket can be resolved first.
              </div>
            )}
            {branchError && <div style={{ fontSize: 11, color: 'var(--danger)', marginTop: 4 }}>{branchError}</div>}
          </PathStep>

          <PathStep
            n="2"
            title="Do the work"
            hint={
              hasBranch
                ? `Commit and push to ${ticket.branch}. Come back here when it's ready for QA.`
                : 'Available once the branch exists.'
            }
            done={stagingPrOpen || onOrPastStaging}
          />

          <PathStep n="3" title={`Put on ${stagingLabel} for QA`} hint={stagingPrHint} done={onOrPastStaging}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {canOpenStagingPr && (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => handleOpenPr('staging')}
                  disabled={openingPr != null}
                >
                  {openingPr === 'staging' ? 'Opening…' : `Open PR into ${stagingLabel}`}
                </button>
              )}
              {(stagingPrOpen || onOrPastStaging) && !canOpenStagingPr && (
                <button type="button" className="btn btn-primary" disabled>
                  Already exists
                </button>
              )}
              {stagingPrOpen && (
                <>
                  <button type="button" className="btn btn-primary" onClick={handleMerge} disabled={merging || closing}>
                    {merging ? 'Merging…' : `Merge PR into ${stagingLabel}`}
                  </button>
                  <button type="button" className="btn btn-danger-outline" onClick={handleClosePr} disabled={closing || merging}>
                    {closing ? 'Closing…' : 'Close PR'}
                  </button>
                </>
              )}
            </div>
          </PathStep>

          <PathStep
            n="4"
            title={`After QA approves, put on ${productionLabel}`}
            hint={productionPrHint}
            done={onOrPastProduction}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {canOpenProductionPr && (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => handleOpenPr('production')}
                  disabled={openingPr != null}
                >
                  {openingPr === 'production' ? 'Opening…' : `Open PR into ${productionLabel}`}
                </button>
              )}
              {(productionPrOpen || onOrPastProduction) && !canOpenProductionPr && (
                <button type="button" className="btn btn-primary" disabled>
                  Already exists
                </button>
              )}
              {productionPrOpen && (
                <>
                  <button type="button" className="btn btn-primary" onClick={handleMerge} disabled={merging || closing}>
                    {merging ? 'Merging…' : `Merge PR into ${productionLabel}`}
                  </button>
                  <button type="button" className="btn btn-danger-outline" onClick={handleClosePr} disabled={closing || merging}>
                    {closing ? 'Closing…' : 'Close PR'}
                  </button>
                </>
              )}
            </div>
          </PathStep>

          {state === 'conflict' && !stagingPrOpen && !productionPrOpen && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-primary" onClick={handleMerge} disabled={merging || closing}>
                {merging ? 'Merging…' : 'Retry merge'}
              </button>
              {ticket.prNumber ? (
                <button type="button" className="btn btn-danger-outline" onClick={handleClosePr} disabled={closing || merging}>
                  {closing ? 'Closing…' : 'Close PR'}
                </button>
              ) : null}
            </div>
          )}
          {prError && <div style={{ fontSize: 11, color: 'var(--danger)' }}>{prError}</div>}
          {closeError && <div style={{ fontSize: 11, color: 'var(--danger)' }}>{closeError}</div>}
          {mergeError && <div style={{ fontSize: 11, color: 'var(--danger)' }}>{mergeError}</div>}
        </div>

        <div style={{ border: '1px solid var(--n-border)', borderRadius: 'var(--r-card)', padding: 11, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="eyebrow">Jira</div>

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
