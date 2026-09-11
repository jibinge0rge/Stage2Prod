import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useEffect, useMemo } from 'react';
import styles from './AppShell.module.css';
import { ROUTES } from '../lib/routeMeta';
import { useApi, useGlobalLoading } from '../lib/api';
import { useAppContext } from '../context/AppContext';
import ResetModal from '../components/ResetModal';
import Toast from '../components/Toast';
import TicketDrawer from '../components/TicketDrawer';
import ThemeToggle from '../components/ThemeToggle';
import RepoSelector from '../components/RepoSelector';
import { useRepoFilter, repoKey, ALL_REPOS } from '../context/RepoFilterContext';
import { initialsFromEmail } from '../lib/initialsFromEmail';

function formatEventTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })} · ${d
    .toISOString()
    .slice(11, 16)} UTC`;
}

export default function AppShell() {
  const location = useLocation();
  const { syncNow, syncing, toast, selectedTicketKey, closeTicket, registerHealthRefresh } = useAppContext();
  const { selectedRepoKey } = useRepoFilter();
  const { data: health, refresh: refreshHealth } = useApi('/health', { intervalMs: 15000 });
  const { data: eventsData } = useApi('/events?limit=1', { intervalMs: 15000 });
  const globalLoading = useGlobalLoading();

  const route = useMemo(
    () => ROUTES.find((r) => r.path === location.pathname) || ROUTES[0],
    [location.pathname]
  );

  // "Nav changes screen and closes the drawer" (per the design brief).
  useEffect(() => {
    closeTicket();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  // Lets pages that add/remove/edit a watched repo (Repositories.jsx)
  // refresh the sidebar's repo list right away instead of waiting up to
  // this hook's own 15s poll interval — previously that meant a manual
  // reload was the only way to see a newly-connected repo show up here.
  useEffect(() => {
    registerHealthRefresh(refreshHealth);
    return () => registerHealthRefresh(null);
  }, [refreshHealth, registerHealthRefresh]);

  const heldLocks = health?.locks?.filter((l) => l.locked) ?? [];
  const lockState = heldLocks.length ? `busy (${heldLocks.length})` : 'idle';
  const lastEventTs = eventsData?.events?.[0]?.timestamp;
  const watchedRepos = health?.watchedRepos ?? [];
  // Prefer the globally-selected repo's real branch names; with "All
  // repos" (or several, possibly differently-named repos) selected, fall
  // back to generic role labels rather than presenting one repo's names
  // as universal.
  const focusedRepo =
    selectedRepoKey !== ALL_REPOS
      ? watchedRepos.find((r) => repoKey(r) === selectedRepoKey)
      : watchedRepos.length === 1
        ? watchedRepos[0]
        : null;
  const productionLabel = focusedRepo?.productionBranch ?? 'Production';
  const stagingLabel = focusedRepo?.stagingBranch ?? 'Staging';

  return (
    <div className={styles.root}>
      <header className={styles.topbar}>
        <img src="/assets/logo/pai-wordmark-white.svg" height={20} alt="Prevalent AI" />
        <span className={styles.topbarDivider} />
        <span className={styles.productName}>Stage2Prod</span>
        <span className={styles.activePill}>
          <span className="dot" style={{ background: 'var(--success)', width: 5, height: 5 }} />
          Automation active
        </span>
        <div className="spacer" />
        <div className={styles.topbarMeta}>
          <span>Git ref locks</span>
          <strong>{lockState}</strong>
        </div>
        <span className={styles.topbarDivider} />
        <div className={styles.lastEvent}>
          Last event <span style={{ color: 'var(--dark-value)' }}>{formatEventTime(lastEventTs)}</span>
        </div>
        <ThemeToggle />
        <div className={styles.avatar} title={health?.jiraEmail || undefined}>
          {initialsFromEmail(health?.jiraEmail) || '—'}
        </div>
        {globalLoading && (
          <div className={styles.loadingBar}>
            <div className={styles.loadingBarFill} />
          </div>
        )}
      </header>

      <div className={styles.body}>
        <aside className={styles.sidebar}>
          <div className={styles.sidebarHeader}>
            <div className={styles.sidebarHeaderTitle}>Release orchestrator</div>
            {watchedRepos.length === 0 ? (
              <div className={styles.sidebarRepoLabel}>
                <span className="mono">no repos watched</span>
              </div>
            ) : (
              <RepoSelector watchedRepos={watchedRepos} />
            )}
          </div>

          <div className={`${styles.sidebarGroupLabel} ${styles.first}`}>Orchestration</div>
          <div className={styles.navList}>
            {ROUTES.filter((r) => r.group === 'orchestration').map((r) => (
              <NavLink
                key={r.path}
                to={r.path}
                className={({ isActive }) => `${styles.navItem} ${isActive ? styles.active : ''}`}
              >
                <img src={`/assets/icons/${r.icon}`} width={16} height={16} alt="" />
                {r.label}
              </NavLink>
            ))}
          </div>

          <div className={styles.sidebarGroupLabel}>Configure</div>
          <div className={styles.navList}>
            {ROUTES.filter((r) => r.group === 'configure').map((r) => (
              <NavLink
                key={r.path}
                to={r.path}
                className={({ isActive }) => `${styles.navItem} ${isActive ? styles.active : ''}`}
              >
                <img src={`/assets/icons/${r.icon}`} width={16} height={16} alt="" />
                {r.label}
              </NavLink>
            ))}
          </div>

          <div className={styles.sidebarSpacer} />
          <div className={styles.legend}>
            <div className={styles.legendTitle}>Branch model</div>
            <div className={styles.legendRows}>
              <div className={styles.legendRow}>
                <span className="dot" style={{ background: 'var(--success)' }} />
                <span className={styles.legendBranch}>{productionLabel}</span>
                <span className={styles.legendState}>validated</span>
              </div>
              <div className={styles.legendRow}>
                <span className="dot" style={{ background: 'var(--brand)' }} />
                <span className={styles.legendBranch}>{stagingLabel}</span>
                <span className={styles.legendState}>ephemeral</span>
              </div>
            </div>
            {!focusedRepo && (
              <div style={{ fontSize: 10, color: 'var(--n-muted)', marginTop: 8 }}>
                Exact names are set per repo — see Repositories.
              </div>
            )}
          </div>
        </aside>

        <main className={styles.main}>
          <div className={styles.contentHeader}>
            <div style={{ minWidth: 0 }}>
              <h1 className={styles.pageTitle}>{route.title}</h1>
              <div className={styles.pageSub}>{route.subtitle}</div>
            </div>
            <div className="spacer" />
            <button type="button" className="btn btn-outline" onClick={syncNow} disabled={syncing}>
              {syncing ? 'Syncing…' : 'Sync now'}
            </button>
          </div>
          <div className={styles.contentBody}>
            <Outlet />
          </div>
        </main>

        {selectedTicketKey && <TicketDrawer ticketKey={selectedTicketKey} onClose={closeTicket} />}
      </div>

      <ResetModal />
      {toast ? <Toast message={toast} /> : null}
    </div>
  );
}
