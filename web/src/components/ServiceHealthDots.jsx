import styles from './ServiceHealthDots.module.css';

function relativeTime(iso) {
  if (!iso) return 'never';
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  return `${Math.round(seconds / 3600)}h ago`;
}

function formatLockRef(ref) {
  if (!ref) return 'ref';
  const hash = ref.indexOf('#');
  const short = hash >= 0 ? ref.slice(hash + 1) : ref;
  return short.replace(/^refs\/heads\//, '');
}

function buildItems(health) {
  if (!health) {
    return [
      { id: 'poller', label: 'Jira poller', color: 'var(--dark-muted)', state: '…', detail: 'Loading…' },
      { id: 'github', label: 'GitHub', color: 'var(--dark-muted)', state: '…', detail: 'Loading…' },
      { id: 'jira', label: 'Jira API', color: 'var(--dark-muted)', state: '…', detail: 'Loading…' },
      { id: 'locks', label: 'Ref lock', color: 'var(--dark-muted)', state: '…', detail: 'Loading…' },
    ];
  }

  const pollerOk = health.poller.lastPollOk !== false;
  const heldLocks = (health.locks || []).filter((l) => l.locked);
  const githubRemaining = health.github.rateLimitRemaining;
  const githubLow = githubRemaining !== null && githubRemaining < 200;
  const jiraRemaining = health.jira.rateLimitRemaining;
  const jiraLow = jiraRemaining !== null && jiraRemaining < 200;

  return [
    {
      id: 'poller',
      label: 'Jira poller',
      color: pollerOk ? 'var(--success)' : 'var(--danger)',
      state: pollerOk ? 'OK' : 'ERROR',
      detail: pollerOk
        ? `last poll ${relativeTime(health.poller.lastPollAt)}${health.dryRun ? ' · dry-run' : ''}`
        : health.poller.lastError || 'last poll failed',
    },
    {
      id: 'github',
      label: 'GitHub token',
      color: githubLow ? 'var(--warning)' : 'var(--success)',
      state: githubLow ? 'LOW' : 'OK',
      detail:
        githubRemaining === null
          ? 'rate limit unknown'
          : `repo write · ${githubRemaining.toLocaleString()} of ${health.github.rateLimitLimit?.toLocaleString() ?? '—'} left`,
    },
    {
      id: 'jira',
      label: 'Jira API token',
      color: jiraLow ? 'var(--warning)' : 'var(--success)',
      state: jiraLow ? 'LOW' : 'OK',
      detail: jiraRemaining === null ? 'rate limit unknown' : `${jiraRemaining.toLocaleString()} requests remaining`,
    },
    {
      id: 'locks',
      label: 'Ref lock',
      color: heldLocks.length ? 'var(--warning)' : 'var(--success)',
      state: heldLocks.length ? 'BUSY' : 'IDLE',
      detail: heldLocks.length
        ? heldLocks.map((l) => `${formatLockRef(l.ref)} · ${l.holder || 'held'}`).join(' · ')
        : 'idle · no contended writes',
    },
  ];
}

const ICONS = {
  poller: (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden>
      <path
        fill="currentColor"
        d="M8 1.5a6.5 6.5 0 1 0 6.3 8.1h-1.55A5 5 0 1 1 8 3v2.2l3.2-2.1L8 1.5Z"
      />
    </svg>
  ),
  github: (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden>
      <path
        fill="currentColor"
        d="M8 1.2a6.8 6.8 0 0 0-2.15 13.25c.34.06.46-.15.46-.33v-1.16c-1.88.41-2.28-.8-2.28-.8-.3-.78-.75-.98-.75-.98-.61-.42.05-.41.05-.41.68.05 1.03.7 1.03.7.6 1.03 1.58.73 1.97.56.06-.44.24-.73.43-.9-1.5-.17-3.08-.75-3.08-3.34 0-.74.26-1.34.7-1.81-.07-.17-.3-.87.06-1.8 0 0 .57-.18 1.86.7a6.4 6.4 0 0 1 3.38 0c1.29-.88 1.86-.7 1.86-.7.36.93.13 1.63.07 1.8.43.47.7 1.07.7 1.81 0 2.6-1.58 3.17-3.09 3.34.24.21.46.62.46 1.25v1.85c0 .18.12.4.47.33A6.8 6.8 0 0 0 8 1.2Z"
      />
    </svg>
  ),
  jira: (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden>
      <path
        fill="currentColor"
        d="M8.9 2.2 4.4 6.7a1.6 1.6 0 0 0 0 2.26l2.47 2.47L12.3 6a1.6 1.6 0 0 0 0-2.26L9.84 1.27A1.3 1.3 0 0 0 8.9 2.2Zm-1.8 11.6 4.5-4.5a1.6 1.6 0 0 0 0-2.26L9.13 4.57 3.7 10a1.6 1.6 0 0 0 0 2.26l2.46 2.47a1.3 1.3 0 0 0 .94.07Z"
      />
    </svg>
  ),
  locks: (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden>
      <path
        fill="currentColor"
        d="M8 1.8A2.7 2.7 0 0 0 5.3 4.5V6H4.2A1.2 1.2 0 0 0 3 7.2v5.6A1.2 1.2 0 0 0 4.2 14h7.6A1.2 1.2 0 0 0 13 12.8V7.2A1.2 1.2 0 0 0 11.8 6H10.7V4.5A2.7 2.7 0 0 0 8 1.8Zm1.3 4.2H6.7V4.5a1.3 1.3 0 1 1 2.6 0V6Z"
      />
    </svg>
  ),
};

/** Compact topbar health: status-colored icon dots; hover reveals full details. */
export default function ServiceHealthDots({ health }) {
  const items = buildItems(health);
  const worst = items.some((i) => i.state === 'ERROR')
    ? 'error'
    : items.some((i) => i.state === 'LOW' || i.state === 'BUSY')
      ? 'warn'
      : 'ok';

  return (
    <div
      className={styles.wrap}
      tabIndex={0}
      aria-label="Service health"
      data-worst={worst}
    >
      <div className={styles.dots}>
        {items.map((item) => (
          <span
            key={item.id}
            className={styles.dot}
            style={{ '--status': item.color }}
            title={`${item.label}: ${item.state}`}
          >
            <span className={styles.icon}>{ICONS[item.id]}</span>
            <span className={styles.badge} />
          </span>
        ))}
      </div>

      <div className={styles.panel} role="tooltip">
        <div className={styles.panelTitle}>Service health</div>
        {items.map((item) => (
          <div key={item.id} className={styles.row}>
            <span className={styles.rowDot} style={{ background: item.color }} />
            <div className={styles.rowBody}>
              <div className={styles.rowLabel}>{item.label}</div>
              <div className={styles.rowDetail}>{item.detail}</div>
            </div>
            <span className={styles.rowState} style={{ color: item.color }}>
              {item.state}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
