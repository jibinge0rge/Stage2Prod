import { useEffect, useMemo, useState } from 'react';
import { useApi, getJson, postJson, patchJson, deleteJson } from '../lib/api';
import { useRegisterRefresh } from '../lib/useRegisterRefresh';
import { useAppContext } from '../context/AppContext';
import CustomSelect from '../components/CustomSelect';
import RepoTeamRoles, { emptyTeamRoles } from '../components/RepoTeamRoles';

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
function BranchSelect({ branches, loading, error, value, onChange, title, style = fieldWidth }) {
  if (branches) {
    const options = branches.includes(value) ? branches : [value, ...branches];
    return <CustomSelect style={style} value={value} options={options} onChange={onChange} title={title} />;
  }
  if (loading) {
    return <CustomSelect style={style} value={null} options={[]} placeholder="Loading…" disabled onChange={() => {}} title={title} />;
  }
  return (
    <input
      style={{ ...style, height: 26, padding: '0 8px', border: '1px solid var(--n-border)', borderRadius: 'var(--r-input)', fontSize: 11, background: 'var(--n-surface)', color: 'var(--n-body)' }}
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

function JiraProjectKeyInput({ value, onChange, title, style }) {
  return (
    <input
      style={{
        width: 110,
        height: 26,
        padding: '0 8px',
        border: '1px solid var(--n-border)',
        borderRadius: 'var(--r-input)',
        fontSize: 11,
        background: 'var(--n-surface)',
        color: 'var(--n-body)',
        ...style,
      }}
      value={value}
      onChange={(e) => onChange(e.target.value.toUpperCase())}
      placeholder="PROJ"
      title={title}
    />
  );
}

function teamRolesSummary(teamRoles) {
  const roles = teamRoles || emptyTeamRoles();
  const parts = [
    ['DE', roles.de?.length || 0],
    ['QA', roles.qa?.length || 0],
    ['DA', roles.da?.length || 0],
  ]
    .filter(([, n]) => n > 0)
    .map(([label, n]) => `${label} ${n}`);
  return parts.length ? parts.join(' · ') : null;
}

function WatchedRepoRow({ repo, onRemove, removing, onSaved, branchCache, setBranchCache, showToast }) {
  const [editing, setEditing] = useState(false);
  const [productionBranch, setProductionBranch] = useState(repo.productionBranch);
  const [stagingBranch, setStagingBranch] = useState(repo.stagingBranch);
  const [jiraProjectKey, setJiraProjectKey] = useState(repo.jiraProjectKey || '');
  const [teamRoles, setTeamRoles] = useState(repo.teamRoles || emptyTeamRoles());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const { branches, loading, error: branchesError } = useRepoBranches(
    repo.owner,
    repo.name,
    branchCache,
    setBranchCache,
    editing
  );

  useEffect(() => {
    if (!editing) {
      setProductionBranch(repo.productionBranch);
      setStagingBranch(repo.stagingBranch);
      setJiraProjectKey(repo.jiraProjectKey || '');
      setTeamRoles(repo.teamRoles || emptyTeamRoles());
    }
  }, [repo, editing]);

  async function save() {
    if (productionBranch === stagingBranch) {
      setError('Production and staging branch names must be different.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await patchJson(`/repos/${repo.owner}/${repo.name}`, {
        productionBranch,
        stagingBranch,
        jiraProjectKey,
        teamRoles,
      });
      setEditing(false);
      const moved = result?.reclassified || [];
      if (moved.length && showToast) {
        const detached = moved.filter((c) => c.detached).length;
        const remapped = moved.length - detached;
        const bits = [];
        if (remapped) bits.push(`reclassified ${remapped}`);
        if (detached) bits.push(`detached ${detached} PR(s) that no longer match`);
        showToast(`Branch settings saved — ${bits.join(', ')}.`);
      } else if (showToast) {
        showToast('Repo settings saved.');
      }
      onSaved(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const teamSummary = teamRolesSummary(repo.teamRoles);

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
            {teamSummary ? (
              <span style={{ fontSize: 11, color: 'var(--n-muted)' }} title="Configured team roles">
                {teamSummary}
              </span>
            ) : null}
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 10 }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
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
                setTeamRoles(repo.teamRoles || emptyTeamRoles());
                setError(null);
              }}
            >
              Cancel
            </button>
          </div>
          <RepoTeamRoles
            value={teamRoles}
            onChange={setTeamRoles}
            projectKey={jiraProjectKey.trim() || null}
          />
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

  const selectWidth = { width: '100%', minWidth: 0 };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: '12px 4px',
        borderBottom: '1px solid var(--n-hairline)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <span className="mono truncate" style={{ fontSize: 12, flex: 1, minWidth: 0, fontWeight: 500, color: 'var(--n-strongest)' }}>
          {repo.fullName}
        </span>
        {repo.private && (
          <span className="badge" style={{ background: 'var(--n-fill-subtle)', color: 'var(--n-muted)' }}>
            private
          </span>
        )}
        {repo.watched && (
          <span className="badge" style={{ background: 'var(--success-fill)', color: 'var(--success-text)' }}>
            watching
          </span>
        )}
      </div>
      {!repo.watched && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1.2fr) minmax(0, 1.2fr) 100px auto',
            gap: 8,
            alignItems: 'center',
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div className="eyebrow" style={{ marginBottom: 4 }}>
              Production
            </div>
            <BranchSelect
              branches={branches}
              loading={loading}
              error={error}
              value={productionBranch}
              onChange={setProductionBranch}
              title="Production branch"
              style={selectWidth}
            />
          </div>
          <div style={{ minWidth: 0 }}>
            <div className="eyebrow" style={{ marginBottom: 4 }}>
              Staging
            </div>
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
              style={selectWidth}
            />
          </div>
          <div style={{ minWidth: 0 }}>
            <div className="eyebrow" style={{ marginBottom: 4 }}>
              Jira key
            </div>
            <JiraProjectKeyInput
              value={jiraProjectKey}
              onChange={setJiraProjectKey}
              title="Jira project key (optional)"
              style={{ width: '100%' }}
            />
          </div>
          <div style={{ alignSelf: 'end' }}>
            <button
              type="button"
              className="btn btn-primary"
              disabled={pending}
              onClick={() => onAdd(repo, { productionBranch, stagingBranch, jiraProjectKey })}
            >
              {pending ? 'Adding…' : 'Watch'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Repositories() {
  const { refreshHealth, showToast, runPageRefresh } = useAppContext();
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
              showToast={showToast}
              onSaved={() => {
                refreshWatched();
                refreshHealth();
                runPageRefresh();
              }}
              branchCache={branchCache}
              setBranchCache={setBranchCache}
            />
          ))
        )}
      </div>

      {pickerOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Connect a repository"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 90,
            background: 'rgba(16, 16, 16, 0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
          }}
          onClick={() => setPickerOpen(false)}
        >
          <div
            className="card"
            style={{
              width: 'min(720px, 100%)',
              maxHeight: 'min(640px, calc(100vh - 48px))',
              display: 'flex',
              flexDirection: 'column',
              padding: 0,
              overflow: 'hidden',
              boxShadow: 'var(--shadow-modal)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '14px 16px',
                borderBottom: '1px solid var(--n-hairline)',
                flexShrink: 0,
              }}
            >
              <div className="card-title">Connect a repository</div>
              <div className="spacer" />
              <button type="button" className="btn btn-plain" onClick={() => setPickerOpen(false)}>
                Close
              </button>
            </div>
            <div style={{ padding: '12px 16px', flexShrink: 0 }}>
              <input
                type="search"
                placeholder="Search your repositories"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                autoFocus
                style={{
                  width: '100%',
                  height: 32,
                  padding: '0 10px',
                  border: '1px solid var(--n-border)',
                  borderRadius: 'var(--r-input)',
                  fontSize: 12,
                  background: 'var(--n-surface)',
                  color: 'var(--n-body)',
                }}
              />
              {addError && <div style={{ fontSize: 11, color: 'var(--danger)', marginTop: 8 }}>{addError}</div>}
              {candidatesError && (
                <div style={{ fontSize: 11, color: 'var(--danger)', marginTop: 8 }}>
                  Couldn't list repositories: {candidatesError}
                </div>
              )}
            </div>
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 16px 12px' }}>
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
        </div>
      )}
    </div>
  );
}
