import { useEffect, useRef, useState } from 'react';
import { getJson } from '../lib/api';

const ROLES = [
  { id: 'de', label: 'DE', hint: 'Staging→prod PRs assign to the default DE' },
  { id: 'qa', label: 'QA', hint: 'Tickets entering In QA assign to the default QA' },
  { id: 'da', label: 'DA', hint: '' },
  { id: 'cdl', label: 'CDL', hint: '' },
];

function emptyDefaults() {
  return { de: null, qa: null, da: null, cdl: null };
}

function emptyRoles() {
  return { de: [], qa: [], da: [], cdl: [], defaults: emptyDefaults() };
}

function withDefaults(roles) {
  return {
    de: roles?.de || [],
    qa: roles?.qa || [],
    da: roles?.da || [],
    cdl: roles?.cdl || [],
    defaults: { ...emptyDefaults(), ...(roles?.defaults || {}) },
  };
}

function PersonChip({ person, isDefault, canSetDefault, onSetDefault, onRemove }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        maxWidth: '100%',
        height: 24,
        padding: '0 6px 0 4px',
        borderRadius: 12,
        background: isDefault ? 'var(--success-fill)' : 'var(--n-fill-subtle)',
        border: `1px solid ${isDefault ? 'var(--success)' : 'var(--n-border)'}`,
        fontSize: 11,
        color: 'var(--n-body)',
      }}
      title={person.displayName}
    >
      {person.avatarUrl ? (
        <img
          src={person.avatarUrl}
          alt=""
          width={16}
          height={16}
          style={{ borderRadius: '50%', flexShrink: 0 }}
        />
      ) : (
        <span
          style={{
            width: 16,
            height: 16,
            borderRadius: '50%',
            background: 'var(--n-border)',
            flexShrink: 0,
          }}
        />
      )}
      <span className="truncate" style={{ maxWidth: 140 }}>
        {person.displayName}
      </span>
      {isDefault ? (
        <span style={{ fontSize: 9, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--success-text)' }}>
          default
        </span>
      ) : canSetDefault ? (
        <button
          type="button"
          onClick={onSetDefault}
          title={`Make ${person.displayName} the default`}
          style={{
            border: 'none',
            background: 'transparent',
            color: 'var(--n-muted)',
            cursor: 'pointer',
            padding: 0,
            fontSize: 9,
            fontWeight: 600,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
          }}
        >
          set default
        </button>
      ) : null}
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${person.displayName}`}
          style={{
            border: 'none',
            background: 'transparent',
            color: 'var(--n-muted)',
            cursor: 'pointer',
            padding: 0,
            fontSize: 12,
            lineHeight: 1,
          }}
        >
          ×
        </button>
      ) : null}
    </span>
  );
}

/**
 * Per-repo DE / QA / DA roster. People are looked up from Jira
 * (assignable to the repo's project key when set). A role with one
 * person is always the default; with several, pick who auto-assignment uses.
 */
export default function RepoTeamRoles({ value, onChange, projectKey, disabled }) {
  const roles = withDefaults(value);
  const [query, setQuery] = useState('');
  const [addRole, setAddRole] = useState('de');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(null);
  const debounceRef = useRef(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setSearching(false);
      setSearchError(null);
      return undefined;
    }

    setSearching(true);
    debounceRef.current = setTimeout(() => {
      const params = new URLSearchParams({ q });
      if (projectKey) params.set('project', projectKey);
      getJson(`/jira/users?${params}`)
        .then((data) => {
          setResults(data.users || []);
          setSearchError(null);
        })
        .catch((err) => {
          setResults([]);
          setSearchError(err.message);
        })
        .finally(() => setSearching(false));
    }, 250);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, projectKey]);

  function addPerson(person) {
    const list = roles[addRole] || [];
    if (list.some((p) => p.accountId === person.accountId)) return;
    const nextList = [...list, {
      accountId: person.accountId,
      displayName: person.displayName,
      avatarUrl: person.avatarUrl || null,
    }];
    const nextDefaults = { ...roles.defaults };
    if (nextList.length === 1) nextDefaults[addRole] = person.accountId;
    onChange({
      ...roles,
      [addRole]: nextList,
      defaults: nextDefaults,
    });
    setQuery('');
    setResults([]);
  }

  function removePerson(roleId, accountId) {
    const nextList = (roles[roleId] || []).filter((p) => p.accountId !== accountId);
    const nextDefaults = { ...roles.defaults };
    if (nextList.length === 1) {
      nextDefaults[roleId] = nextList[0].accountId;
    } else if (nextDefaults[roleId] === accountId) {
      nextDefaults[roleId] = null;
    }
    onChange({
      ...roles,
      [roleId]: nextList,
      defaults: nextDefaults,
    });
  }

  function setDefault(roleId, accountId) {
    onChange({
      ...roles,
      defaults: { ...roles.defaults, [roleId]: accountId },
    });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%' }}>
      <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--n-muted)' }}>
        Team roles
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
        {ROLES.map((role) => {
          const people = roles[role.id] || [];
          const defaultId = people.length === 1 ? people[0].accountId : roles.defaults[role.id];
          const needsDefault = people.length > 1 && !defaultId;
          return (
            <div
              key={role.id}
              style={{
                padding: 10,
                border: `1px solid ${needsDefault ? 'var(--warning)' : 'var(--n-border)'}`,
                borderRadius: 'var(--r-card)',
                background: 'var(--n-app-bg)',
                minWidth: 0,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 4 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--n-strongest)' }}>{role.label}</span>
                <span style={{ fontSize: 10, color: 'var(--n-muted)' }}>{people.length}</span>
              </div>
              {role.hint ? (
                <div style={{ fontSize: 10, color: 'var(--n-muted)', marginBottom: 8 }}>{role.hint}</div>
              ) : (
                <div style={{ marginBottom: 8 }} />
              )}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, minHeight: 24 }}>
                {people.length === 0 ? (
                  <span style={{ fontSize: 11, color: 'var(--n-muted)' }}>None</span>
                ) : (
                  people.map((p) => (
                    <PersonChip
                      key={p.accountId}
                      person={p}
                      isDefault={p.accountId === defaultId}
                      canSetDefault={!disabled && people.length > 1}
                      onSetDefault={() => setDefault(role.id, p.accountId)}
                      onRemove={disabled ? undefined : () => removePerson(role.id, p.accountId)}
                    />
                  ))
                )}
              </div>
              {needsDefault ? (
                <div style={{ fontSize: 10, color: 'var(--warning)', marginTop: 8 }}>
                  Pick a default {role.label} — tickets won't auto-assign until one is set.
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {!disabled ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <select
              value={addRole}
              onChange={(e) => setAddRole(e.target.value)}
              style={{
                height: 28,
                padding: '0 8px',
                border: '1px solid var(--n-border)',
                borderRadius: 'var(--r-input)',
                background: 'var(--n-surface)',
                color: 'var(--n-body)',
                fontSize: 11,
              }}
            >
              {ROLES.map((r) => (
                <option key={r.id} value={r.id}>
                  Add to {r.label}
                </option>
              ))}
            </select>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={projectKey ? `Search Jira users in ${projectKey}…` : 'Search Jira users…'}
              style={{
                flex: 1,
                minWidth: 160,
                height: 28,
                padding: '0 10px',
                border: '1px solid var(--n-border)',
                borderRadius: 'var(--r-input)',
                background: 'var(--n-surface)',
                color: 'var(--n-body)',
                fontSize: 12,
              }}
            />
          </div>
          {!projectKey ? (
            <div style={{ fontSize: 11, color: 'var(--warning)' }}>
              Set a Jira project key for better assignable-user results.
            </div>
          ) : null}
          {searching ? <div style={{ fontSize: 11, color: 'var(--n-muted)' }}>Searching…</div> : null}
          {searchError ? <div style={{ fontSize: 11, color: 'var(--danger)' }}>{searchError}</div> : null}
          {results.length > 0 ? (
            <div
              style={{
                border: '1px solid var(--n-border)',
                borderRadius: 'var(--r-card)',
                background: 'var(--n-surface)',
                maxHeight: 180,
                overflowY: 'auto',
              }}
            >
              {results.map((u) => {
                const already = (roles[addRole] || []).some((p) => p.accountId === u.accountId);
                return (
                  <button
                    key={u.accountId}
                    type="button"
                    disabled={already}
                    onClick={() => addPerson(u)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      width: '100%',
                      padding: '8px 10px',
                      border: 'none',
                      borderBottom: '1px solid var(--n-hairline)',
                      background: 'transparent',
                      cursor: already ? 'default' : 'pointer',
                      opacity: already ? 0.5 : 1,
                      textAlign: 'left',
                      font: 'inherit',
                      color: 'inherit',
                    }}
                  >
                    {u.avatarUrl ? (
                      <img src={u.avatarUrl} alt="" width={20} height={20} style={{ borderRadius: '50%' }} />
                    ) : (
                      <span style={{ width: 20, height: 20, borderRadius: '50%', background: 'var(--n-fill-subtle)' }} />
                    )}
                    <span style={{ fontSize: 12, color: 'var(--n-strongest)' }}>{u.displayName}</span>
                    {already ? (
                      <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--n-muted)' }}>already added</span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export { emptyRoles as emptyTeamRoles };
