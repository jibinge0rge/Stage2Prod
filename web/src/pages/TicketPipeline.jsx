import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useApi } from '../lib/api';
import { useRegisterRefresh } from '../lib/useRegisterRefresh';
import { useAppContext } from '../context/AppContext';
import { useRepoFilter, ALL_REPOS, repoKey } from '../context/RepoFilterContext';
import FilterChips from '../components/FilterChips';
import TicketTable from '../components/TicketTable';
import DownloadTicketsMenu from '../components/DownloadTicketsMenu';
import { matchesTicketFilter, buildTicketFilters } from '../lib/ticketFilters';

export default function TicketPipeline() {
  const [searchParams, setSearchParams] = useSearchParams();
  const filter = searchParams.get('filter') || 'all';
  const [query, setQuery] = useState('');
  const { selectedTicketKey, openTicket } = useAppContext();
  const { selectedRepoKey } = useRepoFilter();

  const ticketsPath =
    selectedRepoKey === ALL_REPOS ? '/tickets' : `/tickets?repo=${encodeURIComponent(selectedRepoKey)}`;
  const { data, refresh } = useApi(ticketsPath, { intervalMs: 15000 });
  const { data: reposData } = useApi('/repos', { intervalMs: 30000 });
  useRegisterRefresh(refresh);

  const allTickets = data?.tickets ?? [];
  const statusHandlerMap = useMemo(() => {
    const repos = reposData?.repos ?? [];
    if (selectedRepoKey !== ALL_REPOS) {
      const repo = repos.find((r) => repoKey(r) === selectedRepoKey);
      return repo?.effectiveStatusHandlerMap || repo?.statusHandlerMap || null;
    }
    // Across all repos: merge maps (later repos win on conflicting status names).
    const merged = {};
    for (const r of repos) {
      Object.assign(merged, r.effectiveStatusHandlerMap || r.statusHandlerMap || {});
    }
    return Object.keys(merged).length ? merged : null;
  }, [reposData, selectedRepoKey]);

  const filterOptions = useMemo(
    () => buildTicketFilters(allTickets, { statusHandlerMap, selectedFilter: filter }),
    [allTickets, statusHandlerMap, filter]
  );

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allTickets.filter((t) => {
      if (!matchesTicketFilter(t, filter, statusHandlerMap)) return false;
      if (!q) return true;
      const repoLabel = t.repo ? `${t.repo.owner}/${t.repo.name}` : '';
      return (
        t.key.toLowerCase().includes(q) ||
        (t.branch || '').toLowerCase().includes(q) ||
        (t.summary || '').toLowerCase().includes(q) ||
        (t.assignee?.name || '').toLowerCase().includes(q) ||
        repoLabel.toLowerCase().includes(q)
      );
    });
  }, [allTickets, filter, query, statusHandlerMap]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <input
          type="search"
          placeholder="Ticket, assignee, branch, or repo"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{
            width: 220,
            height: 28,
            padding: '0 10px',
            border: '1px solid var(--n-border)',
            borderRadius: 'var(--r-input)',
            fontSize: 12,
          }}
        />
        <FilterChips
          value={filter}
          tickets={allTickets}
          statusHandlerMap={statusHandlerMap}
          onChange={(id) => setSearchParams(id === 'all' ? {} : { filter: id })}
        />
        <div className="spacer" />
        <div style={{ fontSize: 11, color: 'var(--n-muted)' }}>
          {rows.length} of {allTickets.length} tickets
        </div>
        <DownloadTicketsMenu
          tickets={allTickets}
          currentRows={rows}
          currentFilter={filter}
          filterOptions={filterOptions}
          statusHandlerMap={statusHandlerMap}
        />
      </div>

      <TicketTable tickets={rows} selectedKey={selectedTicketKey} onSelect={openTicket} />
      <div style={{ fontSize: 11, color: 'var(--n-muted)' }}>
        Rows are read-only records of what the service did. Filters are the five lifecycle
        stages — map your Jira status names under Rules &amp; polling.
      </div>
    </div>
  );
}
