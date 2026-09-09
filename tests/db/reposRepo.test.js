const { createDb } = require('../../src/db');
const { createReposRepo } = require('../../src/db/repositories/reposRepo');

function freshRepo() {
  const db = createDb(':memory:');
  return createReposRepo(db);
}

describe('reposRepo', () => {
  it('adds a repo and lists it as active', () => {
    const repos = freshRepo();
    repos.add('acme', 'widgets');
    expect(repos.list({ activeOnly: true })).toEqual([
      expect.objectContaining({ owner: 'acme', name: 'widgets', active: true }),
    ]);
    expect(repos.isActive('acme', 'widgets')).toBe(true);
  });

  it('soft-removes a repo — it disappears from the active list but not from get()', () => {
    const repos = freshRepo();
    repos.add('acme', 'widgets');
    repos.remove('acme', 'widgets');

    expect(repos.list({ activeOnly: true })).toEqual([]);
    expect(repos.isActive('acme', 'widgets')).toBe(false);
    const row = repos.get('acme', 'widgets');
    expect(row.active).toBe(false);
    expect(row.removedAt).not.toBeNull();
  });

  it('reactivates a previously removed repo on re-add', () => {
    const repos = freshRepo();
    repos.add('acme', 'widgets');
    repos.remove('acme', 'widgets');
    repos.add('acme', 'widgets');

    expect(repos.isActive('acme', 'widgets')).toBe(true);
    expect(repos.get('acme', 'widgets').removedAt).toBeNull();
  });

  it('list({activeOnly: false}) includes removed repos', () => {
    const repos = freshRepo();
    repos.add('acme', 'widgets');
    repos.add('other', 'repo');
    repos.remove('other', 'repo');

    const all = repos.list({ activeOnly: false });
    expect(all).toHaveLength(2);
    const allActiveOnly = repos.list({ activeOnly: true });
    expect(allActiveOnly).toHaveLength(1);
  });

  it('get() returns null for an unknown repo', () => {
    const repos = freshRepo();
    expect(repos.get('nope', 'nope')).toBeNull();
    expect(repos.isActive('nope', 'nope')).toBe(false);
  });

  it('defaults branch names to develop/staging when not specified', () => {
    const repos = freshRepo();
    repos.add('acme', 'widgets');
    expect(repos.get('acme', 'widgets')).toMatchObject({ productionBranch: 'develop', stagingBranch: 'staging' });
  });

  it('persists custom branch names given at add time', () => {
    const repos = freshRepo();
    repos.add('acme', 'widgets', { productionBranch: 'main', stagingBranch: 'qa' });
    expect(repos.get('acme', 'widgets')).toMatchObject({ productionBranch: 'main', stagingBranch: 'qa' });
  });

  it('re-adding a previously removed repo preserves its branch names rather than resetting to defaults', () => {
    const repos = freshRepo();
    repos.add('acme', 'widgets', { productionBranch: 'main', stagingBranch: 'qa' });
    repos.remove('acme', 'widgets');
    repos.add('acme', 'widgets'); // no branch names given this time

    expect(repos.get('acme', 'widgets')).toMatchObject({ productionBranch: 'main', stagingBranch: 'qa' });
  });

  it('update() changes branch names on an already-watched repo', () => {
    const repos = freshRepo();
    repos.add('acme', 'widgets');
    repos.update('acme', 'widgets', { productionBranch: 'main', stagingBranch: 'qa' });
    expect(repos.get('acme', 'widgets')).toMatchObject({ productionBranch: 'main', stagingBranch: 'qa' });
  });

  it('update() with only one field leaves the other unchanged', () => {
    const repos = freshRepo();
    repos.add('acme', 'widgets', { productionBranch: 'main', stagingBranch: 'qa' });
    repos.update('acme', 'widgets', { stagingBranch: 'staging2' });
    expect(repos.get('acme', 'widgets')).toMatchObject({ productionBranch: 'main', stagingBranch: 'staging2' });
  });
});
