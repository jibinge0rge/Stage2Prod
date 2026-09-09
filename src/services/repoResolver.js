const { createTicketMatcher } = require('./ticketMatcher');

/**
 * Resolves which watched repo a Jira ticket's branch/PR actually lives in.
 * Wraps one createTicketMatcher() (single-repo branch/PR search) per
 * active repo, reusing a ticket's already-known repo when possible so we
 * don't re-search every repo on every poll.
 */
function createRepoResolver({ reposRepo, githubRegistry }) {
  const matchers = new Map(); // "owner/name" -> ticketMatcher

  function getMatcher(owner, name) {
    const key = `${owner}/${name}`;
    if (!matchers.has(key)) {
      matchers.set(key, createTicketMatcher(githubRegistry.getClient(owner, name)));
    }
    return matchers.get(key);
  }

  function invalidateAll() {
    for (const matcher of matchers.values()) matcher.invalidate();
  }

  /**
   * @param ticketKey Jira ticket key, e.g. "PROJ-101"
   * @param knownRepo {owner, name} | null — the ticket's previously
   *   resolved repo, if any. Reused as-is unless it's no longer watched.
   * @returns {found:true, owner, name}
   *        | {found:false}
   *        | {found:false, ambiguous:true, candidates:[{owner,name}]}
   */
  async function resolveTicket(ticketKey, knownRepo) {
    if (knownRepo && reposRepo.isActive(knownRepo.owner, knownRepo.name)) {
      return { found: true, owner: knownRepo.owner, name: knownRepo.name };
    }

    const activeRepos = reposRepo.list({ activeOnly: true });
    const candidates = [];
    for (const repo of activeRepos) {
      const matcher = getMatcher(repo.owner, repo.name);
      // eslint-disable-next-line no-await-in-loop
      const branch = await matcher.findBranchForTicket(ticketKey);
      let hasMatch = !!branch;
      if (!hasMatch) {
        // eslint-disable-next-line no-await-in-loop
        const pr = await matcher.findOpenPrForTicket(ticketKey, {});
        hasMatch = !!pr;
      }
      if (hasMatch) candidates.push({ owner: repo.owner, name: repo.name });
    }

    if (candidates.length === 0) return { found: false };
    if (candidates.length > 1) return { found: false, ambiguous: true, candidates };
    return { found: true, owner: candidates[0].owner, name: candidates[0].name };
  }

  return {
    resolveTicket,
    invalidateAll,
    getClient: githubRegistry.getClient,
    getMatcher,
  };
}

module.exports = { createRepoResolver };
