import { Link } from 'react-router-dom';
import { useApi } from '../lib/api';
import { useRegisterRefresh } from '../lib/useRegisterRefresh';
import { useAppContext } from '../context/AppContext';
import { useRepoFilter, repoKey, ALL_REPOS } from '../context/RepoFilterContext';
import { StateBadge } from '../components/Badge';
import { pipelineStyle } from '../lib/styleMaps';

function RepoStagingSection({ entry }) {
  const { openReset } = useAppContext();
  const { repo, staging, develop } = entry;
  const rejectedCount = staging?.tickets?.filter((t) => t.pipelineState === 'rejected').length ?? 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="eyebrow mono">{repo.owner}/{repo.name}</div>

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
            <div className="eyebrow">Tickets merged</div>
            <div className="stat-value">{staging?.tickets?.length ?? '—'}</div>
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
        {(staging?.tickets?.length ?? 0) === 0 ? (
          <div className="empty-state">Staging is clean — nothing merged since the last reset.</div>
        ) : (
          staging.tickets.map((t) => (
            <div
              key={t.key}
              style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderBottom: '1px solid var(--n-hairline)' }}
            >
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--n-strongest)', width: 74, flexShrink: 0 }}>{t.key}</span>
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
      </div>

      <div className="card" style={{ borderColor: 'var(--danger-border)', padding: 16 }}>
        <div className="card-title">Reset staging sandbox</div>
        <p style={{ fontSize: 12, color: 'var(--n-body)', margin: '7px 0 0', maxWidth: 620 }}>
          Force-updates <span className="mono">refs/heads/{repo.stagingBranch}</span> to the current{' '}
          <span className="mono">{repo.productionBranch}</span> SHA. Everything merged into staging since the
          last reset is discarded. Feature branches and open pull requests are untouched.
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14 }}>
          <button type="button" className="btn btn-lg btn-danger" onClick={() => openReset(repo)}>
            Reset staging to {repo.productionBranch}
          </button>
          <span style={{ fontSize: 11, color: 'var(--n-muted)' }}>
            {repo.productionBranch} head <span className="mono">{develop?.headSha ? develop.headSha.slice(0, 7) : '—'}</span>
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
    selectedRepoKey === ALL_REPOS ? allRepos : allRepos.filter((entry) => repoKey(entry.repo) === selectedRepoKey);

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
