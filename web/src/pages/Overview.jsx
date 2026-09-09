import { useCallback, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useApi } from '../lib/api';
import { useRegisterRefresh } from '../lib/useRegisterRefresh';
import { useRepoFilter, repoKey, ALL_REPOS } from '../context/RepoFilterContext';
import KpiTile from '../components/KpiTile';
import ConflictBanner from '../components/ConflictBanner';
import BranchBoard from '../components/BranchBoard';
import ServiceHealthList from '../components/ServiceHealthList';
import { RecentEventsList } from '../components/EventTable';

function startOfTodayIso() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function withRepoParam(path, selectedRepoKey) {
  if (selectedRepoKey === ALL_REPOS) return path;
  const sep = path.includes('?') ? '&' : '?';
  return `${path}${sep}repo=${encodeURIComponent(selectedRepoKey)}`;
}

export default function Overview() {
  const navigate = useNavigate();
  const { selectedRepoKey } = useRepoFilter();
  const { data: health, refresh: refreshHealth } = useApi('/health', { intervalMs: 15000 });
  const { data: ticketsData, refresh: refreshTickets } = useApi(withRepoParam('/tickets', selectedRepoKey), {
    intervalMs: 15000,
  });
  const { data: branchesData, refresh: refreshBranches } = useApi('/branches', { intervalMs: 15000 });
  const { data: untrackedData, refresh: refreshUntracked } = useApi('/untracked', { intervalMs: 30000 });
  const { data: recentEventsData, refresh: refreshRecent } = useApi(
    withRepoParam('/events?limit=4', selectedRepoKey),
    { intervalMs: 15000 }
  );
  const since = useMemo(() => startOfTodayIso(), []);
  const { data: mergedTodayData, refresh: refreshMergedToday } = useApi(
    withRepoParam(`/events?outcome=MERGED&since=${encodeURIComponent(since)}&limit=200`, selectedRepoKey),
    { intervalMs: 30000 }
  );

  const refreshAll = useCallback(() => {
    refreshHealth();
    refreshTickets();
    refreshBranches();
    refreshUntracked();
    refreshRecent();
    refreshMergedToday();
  }, [refreshHealth, refreshTickets, refreshBranches, refreshUntracked, refreshRecent, refreshMergedToday]);
  useRegisterRefresh(refreshAll);

  const tickets = ticketsData?.tickets ?? [];
  const onStaging = tickets.filter((t) => t.pipelineState === 'staging');
  const awaitingDevelop = tickets.filter((t) => t.pipelineState === 'queued');
  const conflicts = tickets.filter((t) => t.pipelineState === 'conflict');
  const mergedEvents = mergedTodayData?.events ?? [];
  const mergedToDevelop = mergedEvents.filter((e) => e.action === 'merge:develop').length;
  const mergedToStaging = mergedEvents.filter((e) => e.action === 'merge:staging').length;

  const allRepoEntries = branchesData?.repos ?? [];
  const repoEntries =
    selectedRepoKey === ALL_REPOS
      ? allRepoEntries
      : allRepoEntries.filter((entry) => repoKey(entry.repo) === selectedRepoKey);

  const untrackedByRepo = new Map(
    (untrackedData?.repos ?? []).map((u) => [repoKey(u.repo), u.stagingCommits?.length ?? 0])
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <ConflictBanner tickets={conflicts} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 12 }}>
        <KpiTile label="On staging" value={onStaging.length} caption="tickets awaiting QA validation" />
        <KpiTile label="Awaiting develop" value={awaitingDevelop.length} caption="QA passed, PR ready to merge" />
        <KpiTile
          label="Conflicts"
          value={conflicts.length}
          caption="blocked, needs local resolution"
          valueColor={conflicts.length ? 'var(--danger)' : undefined}
        />
        <KpiTile
          label="Merged today"
          value={mergedEvents.length}
          caption={`${mergedToDevelop} to develop, ${mergedToStaging} to staging`}
          valueColor="var(--success-text)"
        />
      </div>

      {allRepoEntries.length === 0 ? (
        <div className="card empty-state">
          No repositories watched yet. <Link to="/repos">Connect one</Link> to start matching tickets to branches.
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: repoEntries.length === 1 ? '1fr' : 'repeat(auto-fit,minmax(340px,1fr))',
            gap: 12,
            alignItems: 'start',
          }}
        >
          {repoEntries.map((entry) => (
            <BranchBoard
              key={`${entry.repo.owner}/${entry.repo.name}`}
              entry={entry}
              untrackedStagingCount={untrackedByRepo.get(repoKey(entry.repo)) ?? 0}
            />
          ))}
          <ServiceHealthList health={health} />
        </div>
      )}

      <div className="card">
        <div className="card-header">
          <div className="card-title">Recent automation events</div>
          <div className="spacer" />
          <button type="button" className="btn btn-ghost" onClick={() => navigate('/log')}>
            View all
          </button>
        </div>
        <RecentEventsList events={recentEventsData?.events ?? []} />
      </div>
    </div>
  );
}
