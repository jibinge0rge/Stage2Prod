import { createContext, useCallback, useContext, useState } from 'react';

const STORAGE_KEY = 'stage2prod-repo-filter';
const ALL = 'all';

const RepoFilterContext = createContext(null);

function readStored() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    // Legacy "all" is no longer a valid selection — treat as unset.
    if (!stored || stored === ALL) return null;
    return stored;
  } catch {
    return null;
  }
}

export function RepoFilterProvider({ children }) {
  const [selectedRepoKey, setSelectedRepoKeyState] = useState(readStored);

  const setSelectedRepoKey = useCallback((key) => {
    setSelectedRepoKeyState(key);
    try {
      localStorage.setItem(STORAGE_KEY, key);
    } catch {
      // localStorage unavailable — selection still applies this page load.
    }
  }, []);

  return (
    <RepoFilterContext.Provider value={{ selectedRepoKey, setSelectedRepoKey }}>
      {children}
    </RepoFilterContext.Provider>
  );
}

export function useRepoFilter() {
  const ctx = useContext(RepoFilterContext);
  if (!ctx) throw new Error('useRepoFilter must be used within RepoFilterProvider');
  return ctx;
}

export function repoKey(repo) {
  return repo ? `${repo.owner}/${repo.name}` : null;
}

/** Filters a list of {repo: {owner,name}, ...} entries down to the selected one, or returns all of them. */
export function filterByRepoKey(entries, selectedRepoKey, getRepo = (e) => e.repo) {
  if (selectedRepoKey === ALL) return entries;
  return entries.filter((e) => repoKey(getRepo(e)) === selectedRepoKey);
}

export { ALL as ALL_REPOS };
