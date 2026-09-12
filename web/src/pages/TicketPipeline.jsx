import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useApi } from '../lib/api';
import { useRegisterRefresh } from '../lib/useRegisterRefresh';
import { useAppContext } from '../context/AppContext';
import { useRepoFilter, ALL_REPOS, repoKey } from '../context/RepoFilterContext';
import FilterChips from '../components/FilterChips';
import TicketTable from '../components/TicketTable';
import DownloadTicketsMenu from '../components/DownloadTicketsMenu';
import { matchesTicketFilter, buildTicketFilters } from '../lib/ticketFilters';
import {
  EMPTY_COLUMN_FILTERS,
  hasActiveColumnFilters,
  matchesColumnFilters,
} from '../lib/columnFilters';

const PAGE_SIZE = 25;

export default function TicketPipeline() {
  const [searchParams, setSearchParams] = useSearchParams();
  const filter = searchParams.get('filter') || 'all';
  const [query, setQuery] = useState('');
  const [columnFilters, setColumnFilters] = useState(EMPTY_COLUMN_FILTERS);
  const [page, setPage] = useState(0);
  const { selectedTicketKey, openTicket } = useAppContext();
  const { selectedRepoKey } = useRepoFilter();

  const ticketsPath =
    !selectedRepoKey || selectedRepoKey === ALL_REPOS
      ? '/tickets'
      : `/tickets?repo=${encodeURIComponent(selectedRepoKey)}`;
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
      if (!matchesColumnFilters(t, columnFilters)) return false;
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
  }, [allTickets, filter, query, columnFilters, statusHandlerMap]);

  // Reset to first page when the visible set changes.
  useEffect(() => {
    setPage(0);
  }, [filter, query, columnFilters, selectedRepoKey]);

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE) || 1);
  const safePage = Math.min(page, pageCount - 1);
  const offset = safePage * PAGE_SIZE;
  const pageRows = rows.slice(offset, offset + PAGE_SIZE);
  const showingFrom = rows.length ? offset + 1 : 0;
  const showingTo = offset + pageRows.length;

  useEffect(() => {
    if (page !== safePage) setPage(safePage);
  }, [page, safePage]);


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
        {hasActiveColumnFilters(columnFilters) ? (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setColumnFilters(EMPTY_COLUMN_FILTERS)}
          >
            Clear column filters
          </button>
        ) : null}
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

      <TicketTable
        tickets={pageRows}
        selectedKey={selectedTicketKey}
        onSelect={openTicket}
        columnFilters={columnFilters}
        onColumnFiltersChange={setColumnFilters}
      />

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--n-muted)' }}>
        <span>
          Showing {showingFrom}–{showingTo} of {rows.length}
          {pageCount > 1 ? ` · page ${safePage + 1} of ${pageCount}` : ''}
        </span>
        <div className="spacer" />
        <button
          type="button"
          className="btn btn-outline"
          disabled={safePage <= 0}
          onClick={() => setPage((p) => Math.max(0, p - 1))}
        >
          Previous
        </button>
        <button
          type="button"
          className="btn btn-outline"
          disabled={safePage >= pageCount - 1 || rows.length === 0}
          onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
        >
          Next
        </button>
      </div>

      <div style={{ fontSize: 11, color: 'var(--n-muted)' }}>
        Rows are read-only records of what the service did. Filters are the five lifecycle
        stages — map your Jira status names under Rules &amp; polling.
      </div>
    </div>
  );
}
