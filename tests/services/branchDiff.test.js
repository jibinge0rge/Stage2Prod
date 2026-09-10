const { aheadBy, compareBranchToTargets } = require('../../src/services/branchDiff');

describe('aheadBy', () => {
  it('returns GitHub ahead_by for head vs base', async () => {
    const github = {
      compareCommits: vi.fn().mockResolvedValue({ aheadBy: 3, behindBy: 1 }),
    };
    await expect(aheadBy(github, 'staging', 'feat/PROJ-1')).resolves.toBe(3);
    expect(github.compareCommits).toHaveBeenCalledWith('staging', 'feat/PROJ-1');
  });

  it('returns 0 when compare fails or the client cannot compare', async () => {
    await expect(aheadBy(null, 'staging', 'feat/x')).resolves.toBe(0);
    await expect(aheadBy({}, 'staging', 'feat/x')).resolves.toBe(0);
    const github = { compareCommits: vi.fn().mockRejectedValue(new Error('404')) };
    await expect(aheadBy(github, 'staging', 'feat/x')).resolves.toBe(0);
  });
});

describe('compareBranchToTargets', () => {
  it('compares the feature branch against both staging and production', async () => {
    const github = {
      compareCommits: vi.fn().mockImplementation(async (base) =>
        base === 'qa' ? { aheadBy: 2, behindBy: 0 } : { aheadBy: 4, behindBy: 1 }
      ),
    };
    await expect(
      compareBranchToTargets({
        github,
        branch: 'feat/PROJ-1',
        stagingBranch: 'qa',
        productionBranch: 'main',
      })
    ).resolves.toEqual({ aheadOfStaging: 2, aheadOfProduction: 4 });
    expect(github.compareCommits).toHaveBeenCalledWith('qa', 'feat/PROJ-1');
    expect(github.compareCommits).toHaveBeenCalledWith('main', 'feat/PROJ-1');
  });

  it('returns zeros when there is no branch', async () => {
    await expect(
      compareBranchToTargets({ github: {}, branch: null, stagingBranch: 'qa', productionBranch: 'main' })
    ).resolves.toEqual({ aheadOfStaging: 0, aheadOfProduction: 0 });
  });
});
