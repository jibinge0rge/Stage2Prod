import { Link } from 'react-router-dom';
import { StateBadge } from './Badge';
import { pipelineStyle } from '../lib/styleMaps';
import { useAppContext } from '../context/AppContext';
import styles from './BranchBoard.module.css';

/** Pipeline states that live on a branch lane or the airgap between lanes. */
const ON_PATHWAY = new Set([
  'staging_queued',
  'staging',
  'conflict',
  'rejected',
  'queued',
  'develop',
]);

function shortSha(sha) {
  return sha ? sha.slice(0, 7) : '—';
}

/** Short labels for narrow airgap cards — full names already live in the column title. */
const COMPACT_BADGE_LABELS = {
  staging_queued: 'Queued',
  queued: 'Queued',
  staging: 'On staging',
  develop: 'Merged',
  conflict: 'Conflict',
  rejected: 'Rejected',
  unmerged: 'Open',
  held: 'Held',
};

function TicketCard({ ticket, onSelect, statusLabel, compact = false }) {
  const label = statusLabel ?? ticket.statusLabel ?? ticket.jiraStatus;
  const badgeLabel = compact
    ? COMPACT_BADGE_LABELS[ticket.pipelineState] ?? pipelineStyle(ticket.pipelineState).label
    : undefined;
  return (
    <button
      type="button"
      className={`${styles.ticketCard}${compact ? ` ${styles.ticketCardCompact}` : ''}`}
      onClick={() => onSelect(ticket.key)}
      title={ticket.summary || ticket.key}
    >
      <div className={styles.ticketCardTop}>
        <span className={styles.ticketKey}>{ticket.key}</span>
        {!compact ? (
          <span className={`truncate ${styles.ticketSummary}`}>{ticket.summary || '—'}</span>
        ) : null}
      </div>
      {compact && ticket.summary ? (
        <div className={`truncate ${styles.ticketSummary}`}>{ticket.summary}</div>
      ) : null}
      <div className={styles.ticketCardBottom}>
        <span className={styles.badgeWrap}>
          <StateBadge state={ticket.pipelineState} label={badgeLabel} styleMap={pipelineStyle} />
        </span>
        {!compact && label ? <span className={styles.ticketStatus}>{label}</span> : null}
        {!compact && ticket.assignee?.name ? (
          <span className={styles.assignee} title={ticket.assignee.name}>
            {ticket.assignee.avatarUrl ? (
              <img src={ticket.assignee.avatarUrl} alt="" className={styles.avatar} width={14} height={14} />
            ) : (
              <span className={styles.avatar} />
            )}
            <span className={styles.assigneeName}>{ticket.assignee.name}</span>
          </span>
        ) : null}
      </div>
    </button>
  );
}

function Airgap({ title, tickets, onSelect, emptyLabel }) {
  return (
    <div className={`${styles.lane} ${styles.airgap}`}>
      <div className={styles.airgapHeader}>
        <div className={styles.airgapTitle}>{title}</div>
        <div className={styles.airgapCount}>{tickets.length}</div>
      </div>
      <div className={styles.ticketList}>
        {tickets.length === 0 ? (
          <div className={styles.emptyCenter}>{emptyLabel}</div>
        ) : (
          tickets.map((t) => <TicketCard key={t.key} ticket={t} onSelect={onSelect} compact />)
        )}
      </div>
    </div>
  );
}

function DriftPill({ commitsAhead, onStagingCount }) {
  const known = commitsAhead !== null && commitsAhead !== undefined;
  const behindByTickets = onStagingCount > 0;
  const inSync = known && commitsAhead === 0 && !behindByTickets;

  if (inSync) {
    return <div className={`${styles.driftPill} ${styles.driftPillSync}`}>Production in sync</div>;
  }

  if (behindByTickets) {
    return (
      <div className={`${styles.driftPill} ${styles.driftPillBehind}`}>
        Production behind: {onStagingCount} {onStagingCount === 1 ? 'ticket' : 'tickets'}
        {known && commitsAhead > 0 ? (
          <span style={{ color: 'var(--n-muted)', fontWeight: 400 }}>
            · {commitsAhead} {commitsAhead === 1 ? 'commit' : 'commits'}
          </span>
        ) : null}
      </div>
    );
  }

  if (known && commitsAhead > 0) {
    return (
      <div className={`${styles.driftPill} ${styles.driftPillBehind}`}>
        Staging ahead: {commitsAhead} {commitsAhead === 1 ? 'commit' : 'commits'}
      </div>
    );
  }

  return <div className={styles.driftPill}>Drift unknown</div>;
}

/**
 * Process pathway: Production → (awaiting prod) → Staging → (awaiting staging) → In Dev.
 * Merged tickets only in Production/Staging; awaiting tickets sit in the airgaps.
 */
export default function BranchBoard({ entry, untrackedStagingCount = 0, inDevTickets = [] }) {
  const { openReset, openTicket } = useAppContext();
  const staging = entry?.staging;
  const develop = entry?.develop;
  const repo = entry?.repo;

  const stagingSide = staging?.tickets ?? [];
  const developSide = develop?.tickets ?? [];

  // Merged onto the branch (or still present after QA reject / conflict on staging).
  const onProduction = developSide.filter((t) => t.pipelineState === 'develop');
  const onStaging = stagingSide.filter((t) =>
    t.pipelineState === 'staging' || t.pipelineState === 'conflict' || t.pipelineState === 'rejected'
  );

  // Airgaps — queued for the next merge, not yet on the target branch.
  const awaitingProduction = developSide.filter((t) => t.pipelineState === 'queued');
  const awaitingStaging = stagingSide.filter((t) => t.pipelineState === 'staging_queued');

  // In Dev: feature work not yet in any merge/queue lane.
  const inDev = inDevTickets.filter((t) => !ON_PATHWAY.has(t.pipelineState));

  const commitsAhead = staging?.commitsAheadOfDevelop;

  return (
    <div className={`card ${styles.pathway}`}>
      <div className={styles.pathwayHeader}>
        <div>
          <div className={styles.pathwayTitle}>Process pathway</div>
          {repo ? (
            <div className={styles.repoName}>
              {repo.owner}/{repo.name}
            </div>
          ) : null}
        </div>
        <DriftPill commitsAhead={commitsAhead} onStagingCount={onStaging.length} />
        <div className="spacer" />
        <div style={{ fontSize: 11, color: 'var(--n-muted)' }}>merge commits only</div>
        {repo ? (
          <button
            type="button"
            className="btn btn-outline"
            style={{ borderColor: 'var(--danger-border)', color: 'var(--danger)' }}
            onClick={() => openReset(repo)}
            title={`Confirm reset of ${repo.stagingBranch} to ${repo.productionBranch}`}
          >
            Reset staging
          </button>
        ) : null}
      </div>

      <div className={styles.lanes}>
        <div className={styles.lane}>
          <div className={styles.laneHeader}>
            <span className={styles.laneTitle}>
              <span className="dot" style={{ width: 8, height: 8, background: 'var(--success)' }} />
              Production
            </span>
            <span className={styles.laneBranch}>
              {repo?.productionBranch ?? '—'}
              {develop?.headSha ? ` / ${shortSha(develop.headSha)}` : ''}
            </span>
          </div>
          <div className={styles.flowHint}>Merged onto production</div>
          <div className={styles.ticketList}>
            {onProduction.length === 0 ? (
              <div className={styles.empty}>No recent merges on production.</div>
            ) : (
              onProduction.map((t) => <TicketCard key={t.key} ticket={t} onSelect={openTicket} />)
            )}
          </div>
        </div>

        <Airgap
          title="Awaiting production"
          tickets={awaitingProduction}
          onSelect={openTicket}
          emptyLabel="None queued"
        />

        <div className={styles.lane}>
          <div className={styles.laneHeader}>
            <span className={styles.laneTitle}>
              <span className="dot" style={{ width: 8, height: 8, background: 'var(--brand)' }} />
              Staging
            </span>
            <span className={styles.laneBranch}>
              {repo?.stagingBranch ?? 'staging'}
              {staging?.headSha ? ` / ${shortSha(staging.headSha)}` : ''}
            </span>
          </div>
          <div className={styles.flowHint}>Merged onto staging · under validation</div>
          {untrackedStagingCount > 0 ? (
            <Link to="/untracked" className={styles.untrackedLink}>
              {untrackedStagingCount} without a ticket →
            </Link>
          ) : null}
          <div className={styles.ticketList}>
            {onStaging.length === 0 ? (
              <div className={styles.empty}>Staging is clean.</div>
            ) : (
              onStaging.map((t) => <TicketCard key={t.key} ticket={t} onSelect={openTicket} />)
            )}
          </div>
        </div>

        <Airgap
          title="Awaiting staging"
          tickets={awaitingStaging}
          onSelect={openTicket}
          emptyLabel="None queued"
        />

        <div className={styles.lane}>
          <div className={styles.laneHeader}>
            <span className={styles.laneTitle}>
              <span className="dot" style={{ width: 8, height: 8, background: 'var(--n-muted)' }} />
              In dev
            </span>
          </div>
          <div className={styles.flowHint}>Feature branches · not yet queued</div>
          <div className={styles.ticketList}>
            {inDev.length === 0 ? (
              <div className={styles.empty}>No tickets in progress.</div>
            ) : (
              inDev.map((t) => (
                <TicketCard
                  key={t.key}
                  ticket={t}
                  onSelect={openTicket}
                  statusLabel={t.jiraStatus || 'In progress'}
                />
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
