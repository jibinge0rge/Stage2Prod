import { useEffect, useMemo, useState } from 'react';
import { useApi, getJson, postJson, patchJson, deleteJson } from '../lib/api';
import { useRegisterRefresh } from '../lib/useRegisterRefresh';
import { useAppContext } from '../context/AppContext';
import CustomSelect from '../components/CustomSelect';

const fieldWidth = { width: 150 };

/** Common staging-ish names to prefer as the default staging selection, in order. */
const STAGING_NAME_GUESSES = ['staging', 'stage', 'qa', 'test'];

function guessStagingBranch(branches, productionBranch) {
  const lower = branches.map((b) => b.toLowerCase());
  for (const guess of STAGING_NAME_GUESSES) {
    const idx = lower.indexOf(guess);
    if (idx !== -1 && branches[idx] !== productionBranch) return branches[idx];
  }
  return branches.find((b) => b !== productionBranch) || productionBranch;
}

/**
 * A branch picker: a dropdown once the repo's branch list has loaded, a
 * disabled placeholder while loading, and a plain text input as a
 * fallback if the list couldn't be fetched (so a real name can still be
 * typed rather than blocking on the picker).
 */
function BranchSelect({ branches, loading, error, value, onChange, title }) {
  if (branches) {
    const options = branches.includes(value) ? branches : [value, ...branches];
    return <CustomSelect style={fieldWidth} value={value} options={options} onChange={onChange} title={title} />;
  }
  if (loading) {
    return <CustomSelect style={fieldWidth} value={null} options={[]} placeholder="Loading…" disabled onChange={() => {}} title={title} />;
  }
  return (
    <input
      style={{ ...fieldWidth, height: 26, padding: '0 8px', border: '1px solid var(--n-border)', borderRadius: 'var(--r-input)', fontSize: 11, background: 'var(--n-surface)', color: 'var(--n-body)' }}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      title={error ? `Couldn't load branch list — type a name instead (${error})` : title}
    />
  );
}

/**
 * Fetches (and caches, at the parent's discretion) a repo's branch list.
 * Pass `enabled: false` to skip fetching entirely (e.g. a watched repo's
 * edit form only needs this once the user opens it).
 */
function useRepoBranches(owner, name, cache, setCache, enabled = true) {
  const key = `${owner}/${name}`;
  const cached = cache[key];

  useEffect(() => {
    if (!enabled || cached !== undefined) return;
    let cancelled = false;
    getJson(`/github/repos/${owner}/${name}/branches`)
      .then((data) => {
        if (!cancelled) setCache((prev) => ({ ...prev, [key]: { branches: data.branches } }));
      })
      .catch((err) => {
        if (!cancelled) setCache((prev) => ({ ...prev, [key]: { error: err.message } }));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, cached === undefined]);

  return {
    branches: cached?.branches ?? null,
    loading: enabled && cached === undefined,
    error: cached?.error ?? null,
  };
}

function JiraProjectKeyInput({ value, onChange, title }) {
  return (
    <input
      style={{ width: 110, height: 26, padding: '0 8px', border: '1px solid var(--n-border)', borderRadius: 'var(--r-input)', fontSize: 11, background: 'var(--n-surface)', color: 'var(--n-body)' }}
      value={value}
      onChange={(e) => onChange(e.target.value.toUpperCase())}
      placeholder="PROJ"
      title={title}
    />
  );
}

function WatchedRepoRow({ repo, onRemove, removing, onSaved, branchCache, setBranchCache }) {
  const [editing, setEditing] = useState(false);
  const [productionBranch, setProductionBranch] = useState(repo.productionBranch);
  const [stagingBranch, setStagingBranch] = useState(repo.stagingBranch);
  const [jiraProjectKey, setJiraProjectKey] = useState(repo.jiraProjectKey || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const { branches, loading, error: branchesError } = useRepoBranches(
    repo.owner,
    repo.name,
    branchCache,
    setBranchCache,
    editing
  );

  async function save() {
    if (productionBranch === stagingBranch) {
      setError('Production and staging branch names must be different.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await patchJson(`/repos/${repo.owner}/${repo.name}`, { productionBranch, stagingBranch, jiraProjectKey });
      setEditing(false);
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--n-hairline)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span className="mono" style={{ fontSize: 12, color: 'var(--n-strongest)', flex: 1 }}>
          {repo.owner}/{repo.name}
        </span>
        {!editing && (
          <>
            <span className="mono" style={{ fontSize: 11, color: 'var(--n-muted)' }}>
              {repo.productionBranch} / {repo.stagingBranch}
            </span>
            {repo.jiraProjectKey ? (
              <span className="mono badge" style={{ background: 'var(--n-fill-subtle)', color: 'var(--n-body)' }}>
                Jira: {repo.jiraProjectKey}
              </span>
            ) : (
              <span className="badge" style={{ background: 'var(--warning-fill)', color: 'var(--warning)' }} title="No Jira project key set — this repo's tickets won't be polled">
                no Jira project
              </span>
            )}
          </>
        )}
        <span style={{ fontSize: 11, color: 'var(--n-muted)' }}>
          watching since {new Date(repo.addedAt).toLocaleDateString()}
        </span>
        {!editing && (
          <button type="button" className="btn btn-plain" onClick={() => setEditing(true)}>
            Edit
          </button>
        )}
        <button type="button" className="btn btn-outline" onClick={() => onRemove(repo)} disabled={removing}>
          {removing ? 'Removing…' : 'Stop watching'}
        </button>
      </div>
      {editing && (
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 10, color: 'var(--n-muted)' }}>
            Production branch
            <BranchSelect
              branches={branches}
              loading={loading}
              error={branchesError}
              value={productionBranch}
              onChange={setProductionBranch}
              title="Production branch"
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 10, color: 'var(--n-muted)' }}>
            Staging branch
            <BranchSelect
              branches={branches}
              loading={loading}
              error={branchesError}
              value={stagingBranch}
              onChange={setStagingBranch}
              title="Staging branch"
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 10, color: 'var(--n-muted)' }}>
            Jira project key
            <JiraProjectKeyInput value={jiraProjectKey} onChange={setJiraProjectKey} title="Jira project key" />
          </label>
          <button type="button" className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            className="btn btn-plain"
            onClick={() => {
              setEditing(false);
              setProductionBranch(repo.productionBranch);
              setStagingBranch(repo.stagingBranch);
              setJiraProjectKey(repo.jiraProjectKey || '');
              setError(null);
            }}
          >
            Cancel
          </button>
        </div>
      )}
      {error && <div style={{ fontSize: 11, color: 'var(--danger)', marginTop: 6 }}>{error}</div>}
    </div>
  );
}

function CandidateRow({ repo, pending, onAdd, branchCache, setBranchCache }) {
  const { branches, loading, error } = useRepoBranches(repo.owner, repo.name, branchCache, setBranchCache);
  const [productionBranch, setProductionBranch] = useState(repo.defaultBranch || 'develop');
  const [stagingBranch, setStagingBranch] = useState('staging');
  const [pickedStaging, setPickedStaging] = useState(false);
  const [jiraProjectKey, setJiraProjectKey] = useState('');

  // Once the real branch list loads, upgrade the staging guess from the
  // generic 'staging' default to whatever this repo actually calls it —
  // but only if the user hasn't already picked one themselves.
  useEffect(() => {
    if (branches && !pickedStaging) {
      setStagingBranch(guessStagingBranch(branches, productionBranch));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branches]);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 4px', borderBottom: '1px solid var(--n-hairline)' }}>
      <span className="mono truncate" style={{ fontSize: 12, flex: 1, minWidth: 0 }}>
        {repo.fullName}
      </span>
      {repo.private && (
        <span className="badge" style={{ background: 'var(--n-fill-subtle)', color: 'var(--n-muted)' }}>
          private
        </span>
      )}
      {!repo.watched && (
        <>
          <BranchSelect
            branches={branches}
            loading={loading}
            error={error}
            value={productionBranch}
            onChange={setProductionBranch}
            title="Production branch"
          />
          <BranchSelect
            branches={branches}
            loading={loading}
            error={error}
            value={stagingBranch}
            onChange={(v) => {
              setPickedStaging(true);
              setStagingBranch(v);
            }}
            title="Staging branch"
          />
          <JiraProjectKeyInput value={jiraProjectKey} onChange={setJiraProjectKey} title="Jira project key (optional)" />
        </>
      )}
      <button
        type="button"
        className={repo.watched ? 'btn btn-outline' : 'btn btn-primary'}
        disabled={repo.watched || pending}
        onClick={() => onAdd(repo, { productionBranch, stagingBranch, jiraProjectKey })}
      >
        {repo.watched ? 'Watching' : pending ? 'Adding…' : 'Watch'}
      </button>
    </div>
  );
}

export default function Repositories() {
  const { refreshHealth } = useAppContext();
  const { data: watchedData, refresh: refreshWatched } = useApi('/repos', { intervalMs: 20000 });
  useRegisterRefresh(refreshWatched);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [candidates, setCandidates] = useState(null);
  const [candidatesError, setCandidatesError] = useState(null);
  const [query, setQuery] = useState('');
  const [pendingKey, setPendingKey] = useState(null);
  const [removingKey, setRemovingKey] = useState(null);
  const [addError, setAddError] = useState(null);
  const [branchCache, setBranchCache] = useState({}); // "owner/name" -> {branches}|{error}

  const watched = watchedData?.repos ?? [];

  async function openPicker() {
    setPickerOpen(true);
    setAddError(null);
    if (!candidates) {
      try {
        const data = await getJson('/github/repos');
        setCandidates(data.repos);
      } catch (err) {
        setCandidatesError(err.message);
      }
    }
  }

  async function addRepo(repo, draft) {
    const key = `${repo.owner}/${repo.name}`;
    if (draft.productionBranch === draft.stagingBranch) {
      setAddError(`${key}: production and staging branch names must be different.`);
      return;
    }
    setPendingKey(key);
    setAddError(null);
    try {
      await postJson('/repos', { owner: repo.owner, name: repo.name, ...draft });
      setCandidates((prev) => prev?.map((r) => (r.owner === repo.owner && r.name === repo.name ? { ...r, watched: true } : r)));
      refreshWatched();
      refreshHealth();
    } catch (err) {
      setAddError(`Couldn't add ${key}: ${err.message}`);
    } finally {
      setPendingKey(null);
    }
  }

  async function removeRepo(repo) {
    setRemovingKey(`${repo.owner}/${repo.name}`);
    try {
      await deleteJson(`/repos/${repo.owner}/${repo.name}`);
      refreshWatched();
      refreshHealth();
      setCandidates((prev) => prev?.map((r) => (r.owner === repo.owner && r.name === repo.name ? { ...r, watched: false } : r)));
    } finally {
      setRemovingKey(null);
    }
  }

  const filteredCandidates = useMemo(() => {
    if (!candidates) return [];
    const q = query.trim().toLowerCase();
    if (!q) return candidates;
    return candidates.filter((r) => r.fullName.toLowerCase().includes(q));
  }, [candidates, query]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 820 }}>
      <div className="card">
        <div className="card-header">
          <div className="card-title">Watched repositories</div>
          <div className="spacer" />
          <button type="button" className="btn btn-primary" onClick={openPicker}>
            Connect a repository
          </button>
        </div>
        {watched.length === 0 ? (
          <div className="empty-state">
            No repositories watched yet — Stage2Prod won't match any tickets to branches until you connect one.
          </div>
        ) : (
          watched.map((r) => (
            <WatchedRepoRow
              key={`${r.owner}/${r.name}`}
              repo={r}
              onRemove={removeRepo}
              removing={removingKey === `${r.owner}/${r.name}`}
              onSaved={() => {
                refreshWatched();
                refreshHealth();
              }}
              branchCache={branchCache}
              setBranchCache={setBranchCache}
            />
          ))
        )}
      </div>

      {pickerOpen && (
        <div className="card" style={{ padding: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div className="card-title">Connect a repository</div>
            <div className="spacer" />
            <button type="button" className="btn btn-plain" onClick={() => setPickerOpen(false)}>
              Close
            </button>
          </div>
          <input
            type="search"
            placeholder="Search your repositories"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{
              width: '100%',
              height: 28,
              padding: '0 10px',
              border: '1px solid var(--n-border)',
              borderRadius: 'var(--r-input)',
              fontSize: 12,
              marginTop: 10,
            }}
          />
          {addError && <div style={{ fontSize: 11, color: 'var(--danger)', marginTop: 8 }}>{addError}</div>}
          {candidatesError && (
            <div style={{ fontSize: 11, color: 'var(--danger)', marginTop: 8 }}>
              Couldn't list repositories: {candidatesError}
            </div>
          )}
          <div style={{ maxHeight: 380, overflowY: 'auto', marginTop: 10 }}>
            {candidates === null && !candidatesError ? (
              <div className="empty-state">Loading repositories the token can see…</div>
            ) : (
              filteredCandidates.map((r) => (
                <CandidateRow
                  key={`${r.owner}/${r.name}`}
                  repo={r}
                  pending={pendingKey === `${r.owner}/${r.name}`}
                  onAdd={addRepo}
                  branchCache={branchCache}
                  setBranchCache={setBranchCache}
                />
              ))
            )}
            {candidates && filteredCandidates.length === 0 && <div className="empty-state">No matches.</div>}
          </div>
        </div>
      )}
    </div>
  );
}
