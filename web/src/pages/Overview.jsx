import { useCallback, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useApi } from '../lib/api';
import { useRegisterRefresh } from '../lib/useRegisterRefresh';
import { useRepoFilter, repoKey, ALL_REPOS } from '../context/RepoFilterContext';
import OverviewKpiStrip from '../components/OverviewKpiStrip';
import ConflictBanner from '../components/ConflictBanner';
import BranchBoard from '../components/BranchBoard';
import { RecentEventsList } from '../components/EventTable';
import { isUnderDevelopment } from '../lib/ticketFilters';
import { countMergedToday } from '../lib/mergedToday';

function startOfTodayIso() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function withRepoParam(path, selectedRepoKey) {
  if (!selectedRepoKey || selectedRepoKey === ALL_REPOS) return path;
  const sep = path.includes('?') ? '&' : '?';
  return `${path}${sep}repo=${encodeURIComponent(selectedRepoKey)}`;
}

function eventRepoKey(e) {
  return e.repo ? `${e.repo.owner}/${e.repo.name}` : null;
}

function ticketBelongsToRepo(ticket, repo) {
  if (!ticket?.repo || !repo) return false;
  return ticket.repo.owner === repo.owner && ticket.repo.name === repo.name;
}

/** Per repo, the timestamp (ms) of today's most recent staging reset, if any. */
function latestResetByRepo(resetEvents) {
  const map = new Map();
  for (const e of resetEvents) {
    const key = eventRepoKey(e);
    if (!key) continue;
    const ts = new Date(e.timestamp).getTime();
    if (!map.has(key) || ts > map.get(key)) map.set(key, ts);
  }
  return map;
}

export default function Overview() {
  const navigate = useNavigate();
  const { selectedRepoKey } = useRepoFilter();
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
  // Staging is ephemeral — a reset wipes it, so a merge-to-staging that
  // happened before the most recent reset shouldn't still count as
  // "merged today" once it's been discarded. Merges to develop/production
  // are permanent and unaffected by a staging reset.
  const { data: resetTodayData, refresh: refreshResetToday } = useApi(
    withRepoParam(`/events?outcome=RESET&since=${encodeURIComponent(since)}&limit=200`, selectedRepoKey),
    { intervalMs: 30000 }
  );

  const refreshAll = useCallback(() => {
    refreshTickets();
    refreshBranches();
    refreshUntracked();
    refreshRecent();
    refreshMergedToday();
    refreshResetToday();
  }, [refreshTickets, refreshBranches, refreshUntracked, refreshRecent, refreshMergedToday, refreshResetToday]);
  useRegisterRefresh(refreshAll);

  const tickets = ticketsData?.tickets ?? [];
  const inProgress = tickets.filter(isUnderDevelopment);
  const onStaging = tickets.filter((t) => t.pipelineState === 'staging');
  const awaitingDevelop = tickets.filter((t) => t.pipelineState === 'queued');
  const conflicts = tickets.filter((t) => t.pipelineState === 'conflict');
  const mergedEvents = mergedTodayData?.events ?? [];
  const resetCutoffByRepo = latestResetByRepo(resetTodayData?.events ?? []);
  const { toDevelop: mergedToDevelop, toStaging: mergedToStaging, total: mergedTodayTotal } = countMergedToday(
    mergedEvents,
    resetCutoffByRepo,
    eventRepoKey
  );

  const allRepoEntries = branchesData?.repos ?? [];
  const repoEntries =
    !selectedRepoKey || selectedRepoKey === ALL_REPOS
      ? allRepoEntries.slice(0, 1)
      : allRepoEntries.filter((entry) => repoKey(entry.repo) === selectedRepoKey);

  const untrackedByRepo = new Map(
    (untrackedData?.repos ?? []).map((u) => [repoKey(u.repo), u.stagingCommits?.length ?? 0])
  );

  const kpiItems = [
    {
      label: 'Dev',
      value: inProgress.length,
      onClick: () => navigate('/pipeline?filter=in_progress'),
    },
    {
      label: 'Staging',
      value: onStaging.length,
      onClick: () => navigate('/pipeline?filter=staging'),
    },
    {
      label: 'Awaiting prod',
      value: awaitingDevelop.length,
      onClick: () => navigate('/pipeline?filter=queued'),
    },
    {
      label: 'Conflicts',
      value: conflicts.length,
      valueColor: conflicts.length ? 'var(--danger)' : undefined,
      onClick: () => navigate('/pipeline?filter=conflict'),
    },
    {
      label: 'Merged',
      value: mergedTodayTotal,
      valueColor: 'var(--success-text)',
      onClick: () => navigate('/log'),
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <ConflictBanner tickets={conflicts} />

      <OverviewKpiStrip items={kpiItems} />
      <div style={{ fontSize: 11, color: 'var(--n-muted)', marginTop: -6 }}>
        {mergedToDevelop} to production, {mergedToStaging} to staging today
      </div>

      {allRepoEntries.length === 0 ? (
        <div className="card empty-state">
          No repositories watched yet. <Link to="/repos">Connect one</Link> to start matching tickets to branches.
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: repoEntries.length === 1 ? '1fr' : 'repeat(auto-fit,minmax(900px,1fr))',
            gap: 12,
            alignItems: 'start',
          }}
        >
          {repoEntries.map((entry) => (
            <BranchBoard
              key={`${entry.repo.owner}/${entry.repo.name}`}
              entry={entry}
              untrackedStagingCount={untrackedByRepo.get(repoKey(entry.repo)) ?? 0}
              inDevTickets={inProgress.filter((t) => ticketBelongsToRepo(t, entry.repo))}
            />
          ))}
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
