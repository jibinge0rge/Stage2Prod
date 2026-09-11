import { useEffect, useMemo, useRef, useState } from 'react';
import { useApi, patchJson } from '../lib/api';
import { useRegisterRefresh } from '../lib/useRegisterRefresh';
import { useAppContext } from '../context/AppContext';
import { useRepoFilter, ALL_REPOS, repoKey } from '../context/RepoFilterContext';
import CustomSelect from '../components/CustomSelect';

const STAGE_ORDER = ['open', 'in_progress', 'in_qa', 'ready_for_release', 'done'];

const STAGE_HINTS = {
  open: 'Starting state (To Do / Open).',
  in_progress: 'Set when a branch is created.',
  in_qa: 'Set when a PR is opened to staging.',
  ready_for_release: 'Set when a PR is opened to production.',
  done: 'Set when merged to production.',
};

function mapToRows(map, stages) {
  const source = map || {};
  return STAGE_ORDER.map((id) => {
    const meta = stages.find((s) => s.id === id) || { id, label: id };
    const entry = source[id] || {};
    const jiraStatus = typeof entry === 'string' ? entry : entry.jiraStatus || '';
    const match = typeof entry === 'string'
      ? ''
      : Array.isArray(entry.match)
        ? entry.match.filter((n) => n.toLowerCase() !== jiraStatus.toLowerCase()).join(', ')
        : '';
    return { id, label: meta.label, jiraStatus, match };
  });
}

function rowsToMap(rows) {
  const out = {};
  for (const row of rows) {
    const jiraStatus = row.jiraStatus.trim();
    if (!jiraStatus) continue;
    const match = row.match
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    out[row.id] = { jiraStatus, match };
  }
  return out;
}

function PolicyRow({ title, detail, value, on }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingTop: 11, borderTop: '1px solid var(--n-hairline)' }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--n-strongest)' }}>{title}</div>
        <div style={{ fontSize: 11, color: 'var(--n-muted)' }}>{detail}</div>
      </div>
      <span
        className="badge"
        style={{ background: on ? 'var(--success-fill)' : 'var(--n-fill-subtle)', color: on ? 'var(--success-text)' : 'var(--n-body)' }}
      >
        {value}
      </span>
    </div>
  );
}

function useCountdown(targetIso) {
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
  if (!targetIso) return '—';
  const seconds = Math.round((new Date(targetIso).getTime() - Date.now()) / 1000);
  if (seconds <= 0) return 'due now';
  return `in ${seconds}s`;
}

function StatusMapEditor({ repo, defaults, stages, onSaved, showToast }) {
  const [rows, setRows] = useState(() => mapToRows(repo.effectiveStatusHandlerMap || defaults, stages));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const repoId = `${repo.owner}/${repo.name}`;
  const lastGoodRef = useRef(rows);

  useEffect(() => {
    const next = mapToRows(repo.effectiveStatusHandlerMap || defaults, stages);
    setRows(next);
    lastGoodRef.current = next;
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoId]);

  function setRow(id, patch) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const statusHandlerMap = rowsToMap(rows);
      for (const id of STAGE_ORDER) {
        if (!statusHandlerMap[id]?.jiraStatus) {
          setError(`Set a Jira status for every stage (missing ${id.replace(/_/g, ' ')}).`);
          return;
        }
      }
      lastGoodRef.current = rows;
      const result = await patchJson(`/repos/${repo.owner}/${repo.name}`, { statusHandlerMap });
      const next = mapToRows(result?.repo?.effectiveStatusHandlerMap || statusHandlerMap, stages);
      setRows(next);
      lastGoodRef.current = next;
      onSaved?.(result);
      showToast?.(`Saved status map for ${repo.owner}/${repo.name}`);
    } catch (err) {
      setError(err.message);
      setRows(lastGoodRef.current);
    } finally {
      setSaving(false);
    }
  }

  async function resetDefaults() {
    setSaving(true);
    setError(null);
    try {
      const result = await patchJson(`/repos/${repo.owner}/${repo.name}`, { statusHandlerMap: null });
      const next = mapToRows(result?.repo?.effectiveStatusHandlerMap || defaults, stages);
      setRows(next);
      lastGoodRef.current = next;
      onSaved?.(result);
      showToast?.(`Reset ${repo.owner}/${repo.name} to default status map`);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '140px minmax(140px, 1fr) minmax(160px, 1.2fr)',
          gap: 10,
          padding: '8px 14px',
          background: 'var(--n-fill-subtle)',
          borderBottom: '1px solid var(--n-border)',
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: 'var(--n-muted)',
        }}
      >
        <div>Stage</div>
        <div>Jira status</div>
        <div>Also match</div>
      </div>
      {rows.map((row) => (
        <div
          key={row.id}
          style={{
            display: 'grid',
            gridTemplateColumns: '140px minmax(140px, 1fr) minmax(160px, 1.2fr)',
            gap: 10,
            padding: '10px 14px',
            borderBottom: '1px solid var(--n-hairline)',
            alignItems: 'start',
          }}
        >
          <div>
            <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--n-strongest)' }}>{row.label}</div>
            <div style={{ fontSize: 10, color: 'var(--n-muted)', marginTop: 2 }}>{STAGE_HINTS[row.id]}</div>
          </div>
          <input
            value={row.jiraStatus}
            onChange={(e) => setRow(row.id, { jiraStatus: e.target.value })}
            placeholder="Exact Jira status name"
            style={{
              height: 28,
              padding: '0 8px',
              border: '1px solid var(--n-border)',
              borderRadius: 'var(--r-input)',
              fontSize: 12,
              background: 'var(--n-surface)',
              color: 'var(--n-body)',
            }}
          />
          <input
            value={row.match}
            onChange={(e) => setRow(row.id, { match: e.target.value })}
            placeholder="Optional aliases, comma-separated"
            title="Other Jira status names that count as this stage"
            style={{
              height: 28,
              padding: '0 8px',
              border: '1px solid var(--n-border)',
              borderRadius: 'var(--r-input)',
              fontSize: 12,
              background: 'var(--n-surface)',
              color: 'var(--n-body)',
            }}
          />
        </div>
      ))}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-plain" onClick={resetDefaults} disabled={saving}>
          Reset to defaults
        </button>
        <div className="spacer" />
        {error && <span style={{ fontSize: 11, color: 'var(--danger)' }}>{error}</span>}
        <button type="button" className="btn btn-primary" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save mapping'}
        </button>
      </div>
      <div style={{ padding: '0 14px 12px', fontSize: 11, color: 'var(--n-muted)' }}>
        Only these five stages appear in Ticket pipeline. Rejected / QA Failed are not used.
        Status names must match Jira exactly (case-sensitive) for transitions.
      </div>
    </div>
  );
}

export default function RulesPolling() {
  const { showToast } = useAppContext();
  const { selectedRepoKey, setSelectedRepoKey } = useRepoFilter();
  const { data: health, refresh } = useApi('/health', { intervalMs: 15000 });
  const { data: reposData, refresh: refreshRepos } = useApi('/repos', { intervalMs: 20000 });
  const { data: mapMeta } = useApi('/status-map', { intervalMs: 60000 });
  useRegisterRefresh(() => {
    refresh();
    refreshRepos();
  });
  const nextPollLabel = useCountdown(health?.poller?.nextPollAt);

  const repos = reposData?.repos ?? [];
  const defaults = mapMeta?.defaults ?? {};
  const stages = mapMeta?.stages ?? STAGE_ORDER.map((id) => ({ id, label: id.replace(/_/g, ' ') }));

  const focusedRepo = useMemo(() => {
    if (!repos.length) return null;
    if (selectedRepoKey !== ALL_REPOS) {
      return repos.find((r) => repoKey(r) === selectedRepoKey) || repos[0];
    }
    return repos[0];
  }, [repos, selectedRepoKey]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 920 }}>
      <div className="card">
        <div className="card-header">
          <div className="card-title">Lifecycle status mapping</div>
          <div className="spacer" />
          {repos.length > 0 && (
            <CustomSelect
              style={{ width: 220 }}
              value={focusedRepo ? repoKey(focusedRepo) : null}
              options={repos.map((r) => repoKey(r))}
              onChange={(key) => setSelectedRepoKey(key)}
              title="Watched repository"
            />
          )}
        </div>
        {!focusedRepo ? (
          <div className="empty-state">Watch a repository first — each repo can use its own Jira status names.</div>
        ) : (
          <StatusMapEditor
            key={repoKey(focusedRepo)}
            repo={focusedRepo}
            defaults={defaults}
            stages={stages}
            showToast={showToast}
            onSaved={() => refreshRepos()}
          />
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 12, alignItems: 'stretch' }}>
        <div className="card" style={{ padding: 14, display: 'flex', flexDirection: 'column' }}>
          <div className="card-title">Jira polling</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--n-body)', marginBottom: 4 }}>JQL watched</div>
              <div
                className="mono"
                style={{ padding: '7px 10px', border: '1px solid var(--n-border)', borderRadius: 'var(--r-input)', background: 'var(--n-fill-subtle)', fontSize: 11, color: 'var(--n-body)', overflowX: 'auto', whiteSpace: 'nowrap' }}
              >
                {health?.jiraJql || 'project = PROJ AND status CHANGED AFTER -5m'}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--n-body)', marginBottom: 4 }}>Interval</div>
                <div style={{ padding: '7px 10px', border: '1px solid var(--n-border)', borderRadius: 'var(--r-input)', fontSize: 11, color: 'var(--n-body)' }}>
                  Every {Math.round((health?.poller?.intervalMs ?? 60000) / 1000)} seconds
                </div>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--n-body)', marginBottom: 4 }}>Next poll</div>
                <div style={{ padding: '7px 10px', border: '1px solid var(--n-border)', borderRadius: 'var(--r-input)', fontSize: 11, color: 'var(--n-body)', fontVariantNumeric: 'tabular-nums' }}>
                  {nextPollLabel}
                </div>
              </div>
            </div>
            <div style={{ fontSize: 11, color: 'var(--n-muted)' }}>
              Moving a ticket into your mapped In QA status opens a staging PR; Ready for release opens a production PR.
            </div>
          </div>
        </div>

        <div className="card" style={{ padding: 14, display: 'flex', flexDirection: 'column' }}>
          <div className="card-title">Merge policy</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 11, marginTop: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--n-strongest)' }}>Merge strategy into develop</div>
                <div style={{ fontSize: 11, color: 'var(--n-muted)' }}>merge commit, never squash</div>
              </div>
              <span className="badge" style={{ background: 'var(--n-fill-subtle)', color: 'var(--n-body)' }}>merge</span>
            </div>
            <PolicyRow title="Require passing status checks" detail="blocks develop merges only" value="on" on />
            <PolicyRow title="Delete branch after develop merge" detail="remote only" value="on" on />
          </div>
        </div>
      </div>
    </div>
  );
}
