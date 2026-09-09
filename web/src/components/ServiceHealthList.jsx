function relativeTime(iso) {
  if (!iso) return 'never';
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  return `${Math.round(seconds / 3600)}h ago`;
}

function Row({ dotColor, title, detail, state, stateColor }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '11px 14px',
        borderBottom: '1px solid var(--n-hairline)',
      }}
    >
      <span className="dot" style={{ background: dotColor }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--n-strongest)' }}>{title}</div>
        <div style={{ fontSize: 11, color: 'var(--n-muted)' }}>{detail}</div>
      </div>
      <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', color: stateColor }}>{state}</span>
    </div>
  );
}

export default function ServiceHealthList({ health }) {
  if (!health) {
    return (
      <div className="card">
        <div className="card-header">
          <div className="card-title">Service health</div>
        </div>
        <div className="empty-state">Loading…</div>
      </div>
    );
  }

  const pollerOk = health.poller.lastPollOk !== false;
  const stagingLock = health.locks.find((l) => l.ref === 'refs/heads/staging');
  const developLock = health.locks.find((l) => l.ref === 'refs/heads/develop');
  const anyLockHeld = stagingLock?.locked || developLock?.locked;
  const githubRemaining = health.github.rateLimitRemaining;
  const githubLow = githubRemaining !== null && githubRemaining < 200;
  const jiraRemaining = health.jira.rateLimitRemaining;
  const jiraLow = jiraRemaining !== null && jiraRemaining < 200;

  return (
    <div className="card">
      <div className="card-header">
        <div className="card-title">Service health</div>
      </div>
      <div>
        <Row
          dotColor={pollerOk ? 'var(--success)' : 'var(--danger)'}
          title="Jira poller"
          detail={
            pollerOk
              ? `last poll ${relativeTime(health.poller.lastPollAt)}${health.dryRun ? ' · dry-run' : ''}`
              : health.poller.lastError || 'last poll failed'
          }
          state={pollerOk ? 'OK' : 'ERROR'}
          stateColor={pollerOk ? 'var(--success-text)' : 'var(--danger)'}
        />
        <Row
          dotColor={githubLow ? 'var(--warning)' : 'var(--success)'}
          title="GitHub token"
          detail={
            githubRemaining === null
              ? 'rate limit unknown'
              : `repo write · ${githubRemaining.toLocaleString()} of ${health.github.rateLimitLimit?.toLocaleString() ?? '—'} rate limit left`
          }
          state={githubLow ? 'LOW' : 'OK'}
          stateColor={githubLow ? 'var(--warning)' : 'var(--success-text)'}
        />
        <Row
          dotColor={jiraLow ? 'var(--warning)' : 'var(--success)'}
          title="Jira API token"
          detail={jiraRemaining === null ? 'rate limit unknown' : `${jiraRemaining.toLocaleString()} requests remaining`}
          state={jiraLow ? 'LOW' : 'OK'}
          stateColor={jiraLow ? 'var(--warning)' : 'var(--success-text)'}
        />
        <div style={{ borderBottom: 'none' }}>
          <Row
            dotColor={anyLockHeld ? 'var(--warning)' : 'var(--success)'}
            title="Ref lock"
            detail={
              anyLockHeld
                ? [stagingLock, developLock]
                    .filter((l) => l?.locked)
                    .map((l) => `${l.ref.replace('refs/heads/', '')} held by ${l.holder}`)
                    .join(' · ')
                : 'idle · no contended writes'
            }
            state={anyLockHeld ? 'BUSY' : 'IDLE'}
            stateColor={anyLockHeld ? 'var(--warning)' : 'var(--success-text)'}
          />
        </div>
      </div>
    </div>
  );
}
