import { Link } from 'react-router-dom';
import { useApi } from '../lib/api';
import { useRegisterRefresh } from '../lib/useRegisterRefresh';
import { useRepoFilter, repoKey, ALL_REPOS } from '../context/RepoFilterContext';

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toISOString().slice(0, 10);
}

function PrRow({ pr }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderBottom: '1px solid var(--n-hairline)' }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--n-strongest)', width: 44, flexShrink: 0 }}>#{pr.number}</span>
      <span className="truncate" style={{ fontSize: 12, color: 'var(--n-body)', flex: 1, minWidth: 0 }}>{pr.title}</span>
      <span className="mono truncate" style={{ fontSize: 11, color: 'var(--n-muted)', maxWidth: 180 }}>{pr.headRef} → {pr.baseRef}</span>
      <span style={{ fontSize: 11, color: 'var(--n-muted)', flexShrink: 0 }}>{pr.author ?? '—'}</span>
      <a href={pr.url} target="_blank" rel="noreferrer" className="btn btn-outline" style={{ flexShrink: 0 }}>
        View
      </a>
    </div>
  );
}

function CommitRow({ commit: c }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderBottom: '1px solid var(--n-hairline)' }}>
      <span className="mono" style={{ fontSize: 11, color: 'var(--n-muted)', width: 62, flexShrink: 0 }}>{c.sha.slice(0, 7)}</span>
      <span className="truncate" style={{ fontSize: 12, color: 'var(--n-body)', flex: 1, minWidth: 0 }}>{c.message}</span>
      <span style={{ fontSize: 11, color: 'var(--n-muted)', flexShrink: 0 }}>{c.author ?? '—'}</span>
      <span style={{ fontSize: 11, color: 'var(--n-muted)', flexShrink: 0 }}>{formatDate(c.date)}</span>
    </div>
  );
}

function RepoUntrackedSection({ entry }) {
  const { repo, pullRequestsToStaging, pullRequestsToProduction, stagingCommits } = entry;
  const total = pullRequestsToStaging.length + pullRequestsToProduction.length + stagingCommits.length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="eyebrow mono">{repo.owner}/{repo.name}</div>

      {total === 0 ? (
        <div className="card empty-state">Nothing untracked here — every open PR and staging commit references a tracked ticket.</div>
      ) : (
        <>
          <div className="card">
            <div className="card-header">
              <div className="card-title">Open PRs without a ticket → {repo.stagingBranch} ({pullRequestsToStaging.length})</div>
            </div>
            {pullRequestsToStaging.length === 0 ? (
              <div className="empty-state">None.</div>
            ) : (
              pullRequestsToStaging.map((pr) => <PrRow key={pr.number} pr={pr} />)
            )}
          </div>

          <div className="card">
            <div className="card-header">
              <div className="card-title">Open PRs without a ticket → {repo.productionBranch} ({pullRequestsToProduction.length})</div>
            </div>
            {pullRequestsToProduction.length === 0 ? (
              <div className="empty-state">None.</div>
            ) : (
              pullRequestsToProduction.map((pr) => <PrRow key={pr.number} pr={pr} />)
            )}
          </div>

          <div className="card">
            <div className="card-header">
              <div className="card-title">Untracked merges on {repo.stagingBranch} ({stagingCommits.length})</div>
              <div className="spacer" />
              <div style={{ fontSize: 11, color: 'var(--n-muted)' }}>ahead of {repo.productionBranch}</div>
            </div>
            {stagingCommits.length === 0 ? (
              <div className="empty-state">None — everything ahead of {repo.productionBranch} on {repo.stagingBranch} references a tracked ticket.</div>
            ) : (
              <>
                <p style={{ fontSize: 11, color: 'var(--n-muted)', margin: '2px 14px 8px' }}>
                  {repo.stagingBranch} is your QA sandbox — safe to discard with Reset staging. This just
                  means these landed there without going through a tracked ticket.
                </p>
                {stagingCommits.map((c) => <CommitRow key={c.sha} commit={c} />)}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default function Untracked() {
  const { selectedRepoKey } = useRepoFilter();
  const path =
    !selectedRepoKey || selectedRepoKey === ALL_REPOS
      ? '/untracked'
      : `/untracked?repo=${encodeURIComponent(selectedRepoKey)}`;
  const { data, refresh } = useApi(path, { intervalMs: 30000 });
  useRegisterRefresh(refresh);

  const repos = data?.repos ?? [];

  if (data && repos.length === 0) {
    return (
      <div className="card empty-state">
        No repositories watched yet. <Link to="/repos">Connect one</Link> to see its untracked activity here.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28, maxWidth: 920 }}>
      <p style={{ fontSize: 12, color: 'var(--n-muted)', margin: 0 }}>
        Open pull requests and staging commits that don't reference any ticket key Stage2Prod is currently
        tracking — activity happening outside the Jira-driven workflow. Nothing here is acted on
        automatically.
      </p>
      {repos.map((entry) => (
        <RepoUntrackedSection key={`${entry.repo.owner}/${entry.repo.name}`} entry={entry} />
      ))}
    </div>
  );
}
