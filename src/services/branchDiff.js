/**
 * How many commits the feature branch has that the target branch does
 * not. Used to hide "Open PR" until the developer has actually pushed
 * work — GitHub rejects empty PRs, and a freshly-cut branch from
 * production is identical to production (and often to a reset staging).
 */
async function aheadBy(github, base, head) {
  if (!github || typeof github.compareCommits !== 'function' || !base || !head) return 0;
  try {
    const result = await github.compareCommits(base, head);
    return typeof result?.aheadBy === 'number' ? result.aheadBy : 0;
  } catch {
    return 0;
  }
}

async function compareBranchToTargets({ github, branch, stagingBranch, productionBranch }) {
  if (!branch) return { aheadOfStaging: 0, aheadOfProduction: 0 };
  const [aheadOfStaging, aheadOfProduction] = await Promise.all([
    aheadBy(github, stagingBranch, branch),
    aheadBy(github, productionBranch, branch),
  ]);
  return { aheadOfStaging, aheadOfProduction };
}

module.exports = { aheadBy, compareBranchToTargets };
