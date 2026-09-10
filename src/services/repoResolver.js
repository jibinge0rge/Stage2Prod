const { createTicketMatcher } = require('./ticketMatcher');
const { projectKeyFromTicket } = require('../lib/jiraKey');

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
   * Cheap, synchronous, no-GitHub-calls repo lookup by Jira project key
   * alone — every active repo sharing the ticket's project key. Exposed
   * separately from resolveTicket so the poller can tag a ticket with its
   * repo as soon as it's ever seen (visibility), not only once a status
   * transition actually gets processed.
   */
  function matchReposByProjectKey(ticketKey, activeRepos = reposRepo.list({ activeOnly: true })) {
    const projectKey = projectKeyFromTicket(ticketKey);
    return activeRepos.filter((r) => r.jiraProjectKey === projectKey);
  }

  /**
   * Unambiguous project-key-only match, or null (no match, or 2+ repos
   * share the key — genuinely ambiguous without a branch/PR search).
   */
  function matchByProjectKeyOnly(ticketKey) {
    const matches = matchReposByProjectKey(ticketKey);
    return matches.length === 1 ? { owner: matches[0].owner, name: matches[0].name } : null;
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

    // Fast path: the ticket's Jira project key maps to exactly one
    // watched repo — no GitHub calls needed at all. If it maps to more
    // than one (e.g. a monorepo split across GitHub repos sharing one
    // Jira project), narrow the branch/PR search to just those instead
    // of searching every watched repo.
    const byProjectKey = matchReposByProjectKey(ticketKey, activeRepos);
    if (byProjectKey.length === 1) {
      return { found: true, owner: byProjectKey[0].owner, name: byProjectKey[0].name };
    }

    const searchSpace = byProjectKey.length > 1 ? byProjectKey : activeRepos;
    const candidates = [];
    for (const repo of searchSpace) {
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
    matchByProjectKeyOnly,
    invalidateAll,
    getClient: githubRegistry.getClient,
    getMatcher,
  };
}

module.exports = { createRepoResolver };
