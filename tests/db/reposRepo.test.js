const { createTestDb } = require('../setup');

async function freshRepo() {
  const { reposRepo } = await createTestDb();
  return reposRepo;
}

describe('reposRepo', () => {
  it('adds a repo and lists it as active', async () => {
    const repos = await freshRepo();
    await repos.add('acme', 'widgets');
    expect(await repos.list({ activeOnly: true })).toEqual([
      expect.objectContaining({ owner: 'acme', name: 'widgets', active: true }),
    ]);
    expect(await repos.isActive('acme', 'widgets')).toBe(true);
  });

  it('soft-removes a repo — it disappears from the active list but not from get()', async () => {
    const repos = await freshRepo();
    await repos.add('acme', 'widgets');
    await repos.remove('acme', 'widgets');

    expect(await repos.list({ activeOnly: true })).toEqual([]);
    expect(await repos.isActive('acme', 'widgets')).toBe(false);
    const row = await repos.get('acme', 'widgets');
    expect(row.active).toBe(false);
    expect(row.removedAt).not.toBeNull();
  });

  it('reactivates a previously removed repo on re-add', async () => {
    const repos = await freshRepo();
    await repos.add('acme', 'widgets');
    await repos.remove('acme', 'widgets');
    await repos.add('acme', 'widgets');

    expect(await repos.isActive('acme', 'widgets')).toBe(true);
    expect((await repos.get('acme', 'widgets')).removedAt).toBeNull();
  });

  it('list({activeOnly: false}) includes removed repos', async () => {
    const repos = await freshRepo();
    await repos.add('acme', 'widgets');
    await repos.add('other', 'repo');
    await repos.remove('other', 'repo');

    const all = await repos.list({ activeOnly: false });
    expect(all).toHaveLength(2);
    const allActiveOnly = await repos.list({ activeOnly: true });
    expect(allActiveOnly).toHaveLength(1);
  });

  it('get() returns null for an unknown repo', async () => {
    const repos = await freshRepo();
    expect(await repos.get('nope', 'nope')).toBeNull();
    expect(await repos.isActive('nope', 'nope')).toBe(false);
  });

  it('defaults branch names to develop/staging when not specified', async () => {
    const repos = await freshRepo();
    await repos.add('acme', 'widgets');
    expect(await repos.get('acme', 'widgets')).toMatchObject({ productionBranch: 'develop', stagingBranch: 'staging' });
  });

  it('persists custom branch names given at add time', async () => {
    const repos = await freshRepo();
    await repos.add('acme', 'widgets', { productionBranch: 'main', stagingBranch: 'qa' });
    expect(await repos.get('acme', 'widgets')).toMatchObject({ productionBranch: 'main', stagingBranch: 'qa' });
  });

  it('re-adding a previously removed repo preserves its branch names rather than resetting to defaults', async () => {
    const repos = await freshRepo();
    await repos.add('acme', 'widgets', { productionBranch: 'main', stagingBranch: 'qa' });
    await repos.remove('acme', 'widgets');
    await repos.add('acme', 'widgets'); // no branch names given this time

    expect(await repos.get('acme', 'widgets')).toMatchObject({ productionBranch: 'main', stagingBranch: 'qa' });
  });

  it('update() changes branch names on an already-watched repo', async () => {
    const repos = await freshRepo();
    await repos.add('acme', 'widgets');
    await repos.update('acme', 'widgets', { productionBranch: 'main', stagingBranch: 'qa' });
    expect(await repos.get('acme', 'widgets')).toMatchObject({ productionBranch: 'main', stagingBranch: 'qa' });
  });

  it('update() with only one field leaves the other unchanged', async () => {
    const repos = await freshRepo();
    await repos.add('acme', 'widgets', { productionBranch: 'main', stagingBranch: 'qa' });
    await repos.update('acme', 'widgets', { stagingBranch: 'staging2' });
    expect(await repos.get('acme', 'widgets')).toMatchObject({ productionBranch: 'main', stagingBranch: 'staging2' });
  });

  it('jiraProjectKey defaults to null when not specified', async () => {
    const repos = await freshRepo();
    await repos.add('acme', 'widgets');
    expect((await repos.get('acme', 'widgets')).jiraProjectKey).toBeNull();
  });

  it('persists a jiraProjectKey given at add time', async () => {
    const repos = await freshRepo();
    await repos.add('acme', 'widgets', { jiraProjectKey: 'PROJ' });
    expect((await repos.get('acme', 'widgets')).jiraProjectKey).toBe('PROJ');
  });

  it('update() sets a jiraProjectKey that was not there before', async () => {
    const repos = await freshRepo();
    await repos.add('acme', 'widgets');
    await repos.update('acme', 'widgets', { jiraProjectKey: 'PROJ' });
    expect((await repos.get('acme', 'widgets')).jiraProjectKey).toBe('PROJ');
  });

  it('update() omitting jiraProjectKey leaves it unchanged', async () => {
    const repos = await freshRepo();
    await repos.add('acme', 'widgets', { jiraProjectKey: 'PROJ' });
    await repos.update('acme', 'widgets', { productionBranch: 'main' });
    expect((await repos.get('acme', 'widgets')).jiraProjectKey).toBe('PROJ');
  });

  it('update() with an empty-string jiraProjectKey clears it back to null', async () => {
    const repos = await freshRepo();
    await repos.add('acme', 'widgets', { jiraProjectKey: 'PROJ' });
    await repos.update('acme', 'widgets', { jiraProjectKey: '' });
    expect((await repos.get('acme', 'widgets')).jiraProjectKey).toBeNull();
  });

  it('re-adding a previously removed repo preserves its jiraProjectKey rather than resetting it', async () => {
    const repos = await freshRepo();
    await repos.add('acme', 'widgets', { jiraProjectKey: 'PROJ' });
    await repos.remove('acme', 'widgets');
    await repos.add('acme', 'widgets');
    expect((await repos.get('acme', 'widgets')).jiraProjectKey).toBe('PROJ');
  });
});
