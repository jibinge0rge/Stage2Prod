import { Link } from 'react-router-dom';
import { useApi } from '../lib/api';
import { useRegisterRefresh } from '../lib/useRegisterRefresh';
import { useAppContext } from '../context/AppContext';
import { useRepoFilter, repoKey, ALL_REPOS } from '../context/RepoFilterContext';
import { StateBadge } from '../components/Badge';
import { pipelineStyle } from '../lib/styleMaps';

function countByState(tickets, state) {
  return tickets?.filter((t) => t.pipelineState === state).length ?? 0;
}

function RepoStagingSection({ entry }) {
  const { openReset } = useAppContext();
  const { repo, staging, develop } = entry;
  const tickets = staging?.tickets ?? [];
  const onStagingCount = countByState(tickets, 'staging');
  const awaitingMergeCount = countByState(tickets, 'staging_queued');
  const conflictCount = countByState(tickets, 'conflict');
  const rejectedCount = countByState(tickets, 'rejected');
  const hasAnything = tickets.length > 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="eyebrow mono">
        {repo.owner}/{repo.name}
      </div>

      <div className="card" style={{ padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <div className="card-title">Divergence from {repo.productionBranch}</div>
          <div className="spacer" />
          <div style={{ fontSize: 11, color: 'var(--n-muted)' }}>live</div>
        </div>
        <div style={{ display: 'flex', gap: 28, marginTop: 14, flexWrap: 'wrap' }}>
          <div>
            <div className="eyebrow">Commits ahead</div>
            <div className="stat-value">{staging?.commitsAheadOfDevelop ?? '—'}</div>
          </div>
          <div>
            <div className="eyebrow">On staging</div>
            <div className="stat-value">{onStagingCount}</div>
          </div>
          <div>
            <div className="eyebrow">Awaiting merge</div>
            <div className="stat-value" style={{ color: awaitingMergeCount ? 'var(--n-body)' : undefined }}>
              {awaitingMergeCount}
            </div>
          </div>
          <div>
            <div className="eyebrow">Rejected, still present</div>
            <div className="stat-value" style={{ color: rejectedCount ? 'var(--warning)' : undefined }}>
              {rejectedCount}
            </div>
          </div>
          <div>
            <div className="eyebrow">Staging head</div>
            <div className="mono" style={{ fontSize: 14, lineHeight: '30px', fontWeight: 500, color: 'var(--n-body)' }}>
              {staging?.headSha ? staging.headSha.slice(0, 7) : '—'}
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title">What is on staging right now</div>
        </div>
        {!hasAnything ? (
          <div className="empty-state">Staging is clean — nothing merged or queued since the last reset.</div>
        ) : (
          tickets.map((t) => (
            <div
              key={t.key}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '10px 14px',
                borderBottom: '1px solid var(--n-hairline)',
              }}
            >
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--n-strongest)', width: 74, flexShrink: 0 }}>
                {t.key}
              </span>
              <span
                className="truncate"
                style={{ fontSize: 12, color: 'var(--n-body)', flex: 1, minWidth: 0 }}
                title={t.summary || undefined}
              >
                {t.summary || '—'}
              </span>
              <span className="mono" style={{ fontSize: 11, color: 'var(--n-muted)', flexShrink: 0 }}>
                {t.statusLabel}
              </span>
              <StateBadge state={t.pipelineState} styleMap={pipelineStyle} />
            </div>
          ))
        )}
        {conflictCount > 0 ? (
          <div style={{ padding: '8px 14px', fontSize: 11, color: 'var(--warning)' }}>
            {conflictCount} ticket{conflictCount === 1 ? '' : 's'} in conflict
          </div>
        ) : null}
      </div>

      <div className="card" style={{ borderColor: 'var(--danger-border)', padding: 16 }}>
        <div className="card-title">Reset staging sandbox</div>
        <p style={{ fontSize: 12, color: 'var(--n-body)', margin: '7px 0 0', maxWidth: 620 }}>
          Moves <span className="mono">refs/heads/{repo.stagingBranch}</span> to the current{' '}
          <span className="mono">{repo.productionBranch}</span> tip. Everything actually merged into staging
          since the last reset is discarded; open feature PRs are untouched. You will confirm in a dialog
          before anything runs. If staging is branch-protected, Stage2Prod opens a reset PR instead of
          force-pushing.
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14 }}>
          <button type="button" className="btn btn-lg btn-danger" onClick={() => openReset(repo)}>
            Reset staging to {repo.productionBranch}
          </button>
          <span style={{ fontSize: 11, color: 'var(--n-muted)' }}>
            {repo.productionBranch} head{' '}
            <span className="mono">{develop?.headSha ? develop.headSha.slice(0, 7) : '—'}</span>
          </span>
        </div>
      </div>
    </div>
  );
}

export default function StagingSandbox() {
  const { data, refresh } = useApi('/branches', { intervalMs: 15000 });
  useRegisterRefresh(refresh);
  const { selectedRepoKey } = useRepoFilter();

  const allRepos = data?.repos ?? [];
  const repos =
    !selectedRepoKey || selectedRepoKey === ALL_REPOS
      ? allRepos.slice(0, 1)
      : allRepos.filter((entry) => repoKey(entry.repo) === selectedRepoKey);

  if (data && allRepos.length === 0) {
    return (
      <div className="card empty-state">
        No repositories watched yet. <Link to="/repos">Connect one</Link> to see its staging sandbox here.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28, maxWidth: 920 }}>
      {repos.map((entry) => (
        <RepoStagingSection key={`${entry.repo.owner}/${entry.repo.name}`} entry={entry} />
      ))}
    </div>
  );
}
