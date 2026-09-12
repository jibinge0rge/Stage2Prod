import { useEffect, useRef, useState } from 'react';
import { getJson } from '../lib/api';

const ROLES = [
  { id: 'de', label: 'DE' },
  { id: 'qa', label: 'QA' },
  { id: 'da', label: 'DA' },
];

function emptyRoles() {
  return { de: [], qa: [], da: [] };
}

function PersonChip({ person, onRemove }) {
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
        background: 'var(--n-fill-subtle)',
        border: '1px solid var(--n-border)',
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
 * (assignable to the repo's project key when set).
 */
export default function RepoTeamRoles({ value, onChange, projectKey, disabled }) {
  const roles = value || emptyRoles();
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
    onChange({
      ...roles,
      [addRole]: [...list, {
        accountId: person.accountId,
        displayName: person.displayName,
        avatarUrl: person.avatarUrl || null,
      }],
    });
    setQuery('');
    setResults([]);
  }

  function removePerson(roleId, accountId) {
    onChange({
      ...roles,
      [roleId]: (roles[roleId] || []).filter((p) => p.accountId !== accountId),
    });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%' }}>
      <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--n-muted)' }}>
        Team roles
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
        {ROLES.map((role) => (
          <div
            key={role.id}
            style={{
              padding: 10,
              border: '1px solid var(--n-border)',
              borderRadius: 'var(--r-card)',
              background: 'var(--n-app-bg)',
              minWidth: 0,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--n-strongest)' }}>{role.label}</span>
              <span style={{ fontSize: 10, color: 'var(--n-muted)' }}>{(roles[role.id] || []).length}</span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, minHeight: 24 }}>
              {(roles[role.id] || []).length === 0 ? (
                <span style={{ fontSize: 11, color: 'var(--n-muted)' }}>None</span>
              ) : (
                (roles[role.id] || []).map((p) => (
                  <PersonChip
                    key={p.accountId}
                    person={p}
                    onRemove={disabled ? undefined : () => removePerson(role.id, p.accountId)}
                  />
                ))
              )}
            </div>
          </div>
        ))}
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
