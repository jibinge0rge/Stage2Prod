import { useEffect } from 'react';
import { useRepoFilter, repoKey, ALL_REPOS } from '../context/RepoFilterContext';
import CustomSelect from './CustomSelect';

/**
 * Global "which repo am I looking at" control — persisted, affects
 * Overview/Ticket pipeline/Staging sandbox everywhere at once, so you
 * don't have to scan every watched repo's card to find the one you care
 * about when watching more than one.
 */
export default function RepoSelector({ watchedRepos }) {
  const { selectedRepoKey, setSelectedRepoKey } = useRepoFilter();
  const repos = watchedRepos ?? [];

  // If the stored selection points at a repo that's since been unwatched,
  // fall back to "All repos" rather than silently showing nothing.
  useEffect(() => {
    if (selectedRepoKey === ALL_REPOS) return;
    if (repos.length === 0) return;
    const stillWatched = repos.some((r) => repoKey(r) === selectedRepoKey);
    if (!stillWatched) setSelectedRepoKey(ALL_REPOS);
  }, [repos, selectedRepoKey, setSelectedRepoKey]);

  if (repos.length === 0) return null;

  const options = [
    { value: ALL_REPOS, label: `All repos (${repos.length})` },
    ...repos.map((r) => ({ value: repoKey(r), label: repoKey(r) })),
  ];

  return (
    <CustomSelect
      value={selectedRepoKey}
      options={options}
      onChange={setSelectedRepoKey}
      title="Which watched repo to show"
      style={{ marginTop: 6 }}
    />
  );
}
