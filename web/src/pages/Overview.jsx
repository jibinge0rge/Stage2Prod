import { useCallback, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useApi } from '../lib/api';
import { useRegisterRefresh } from '../lib/useRegisterRefresh';
import { useRepoFilter, repoKey, ALL_REPOS } from '../context/RepoFilterContext';
import KpiTile from '../components/KpiTile';
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <ConflictBanner tickets={conflicts} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 12 }}>
        <KpiTile
          label="In progress"
          value={inProgress.length}
          caption="under development, not yet on staging"
          onClick={() => navigate('/pipeline?filter=in_progress')}
        />
        <KpiTile label="On staging" value={onStaging.length} caption="tickets awaiting QA validation" />
        <KpiTile label="Awaiting production" value={awaitingDevelop.length} caption="QA passed, PR ready to merge" />
        <KpiTile
          label="Conflicts"
          value={conflicts.length}
          caption="blocked, needs local resolution"
          valueColor={conflicts.length ? 'var(--danger)' : undefined}
        />
        <KpiTile
          label="Merged today"
          value={mergedTodayTotal}
          caption={`${mergedToDevelop} to production, ${mergedToStaging} to staging`}
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
