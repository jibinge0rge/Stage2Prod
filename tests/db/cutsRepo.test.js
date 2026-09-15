const { createTestDb } = require('../setup');

describe('cutsRepo', () => {
  it('inserts and lists cuts newest first', async () => {
    const { cutsRepo } = await createTestDb();
    await cutsRepo.insert({
      repoOwner: 'acme',
      repoName: 'widgets',
      branchName: 'prod-old',
      sha: 'aaa',
      stagingSha: 'aaa',
      createdAt: '2026-09-01T00:00:00.000Z',
      tickets: [{ key: 'PROJ-1', summary: 'First' }],
    });
    await cutsRepo.insert({
      repoOwner: 'acme',
      repoName: 'widgets',
      branchName: 'prod-new',
      sha: 'bbb',
      stagingSha: 'bbb',
      previousSha: 'aaa',
      createdAt: '2026-09-14T00:00:00.000Z',
      tickets: [{ key: 'PROJ-2', summary: 'Second' }],
    });

    const cuts = await cutsRepo.list('acme', 'widgets');
    expect(cuts.map((c) => c.branchName)).toEqual(['prod-new', 'prod-old']);
    expect(cuts[0].tickets).toEqual([{ key: 'PROJ-2', summary: 'Second' }]);
    expect((await cutsRepo.getByBranch('acme', 'widgets', 'prod-old')).sha).toBe('aaa');
  });

  it('scopes list to a repo', async () => {
    const { cutsRepo } = await createTestDb();
    await cutsRepo.insert({
      repoOwner: 'acme',
      repoName: 'widgets',
      branchName: 'prod-a',
      sha: 'a',
      stagingSha: 'a',
    });
    await cutsRepo.insert({
      repoOwner: 'acme',
      repoName: 'other',
      branchName: 'prod-b',
      sha: 'b',
      stagingSha: 'b',
    });
    expect(await cutsRepo.list('acme', 'widgets')).toHaveLength(1);
    expect((await cutsRepo.list('acme', 'other'))[0].branchName).toBe('prod-b');
  });
});
