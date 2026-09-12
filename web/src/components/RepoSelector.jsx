import { useEffect } from 'react';
import { useRepoFilter, repoKey, ALL_REPOS } from '../context/RepoFilterContext';
import CustomSelect from './CustomSelect';

/**
 * Global "which repo am I looking at" control — persisted, affects
 * Overview/Ticket pipeline/Staging sandbox everywhere at once.
 * Always selects a concrete watched repo (no "All repos" aggregate).
 */
export default function RepoSelector({ watchedRepos }) {
  const { selectedRepoKey, setSelectedRepoKey } = useRepoFilter();
  const repos = watchedRepos ?? [];

  useEffect(() => {
    if (repos.length === 0) return;
    const stillWatched = repos.some((r) => repoKey(r) === selectedRepoKey);
    if (!stillWatched || selectedRepoKey === ALL_REPOS) {
      setSelectedRepoKey(repoKey(repos[0]));
    }
  }, [repos, selectedRepoKey, setSelectedRepoKey]);

  if (repos.length === 0) return null;

  const options = repos.map((r) => ({ value: repoKey(r), label: repoKey(r) }));
  const value = options.some((o) => o.value === selectedRepoKey) ? selectedRepoKey : options[0].value;

  return (
    <CustomSelect
      value={value}
      options={options}
      onChange={setSelectedRepoKey}
      title="Which watched repo to show"
      style={{ marginTop: 6 }}
    />
  );
}
