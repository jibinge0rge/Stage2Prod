/**
 * Matches a Jira ticket key to a GitHub branch or open PR by substring
 * match on the ticket key, e.g. PROJ-101 matches feat/PROJ-101-auth.
 * Branch/PR lists are cached briefly per call site (poll tick) to avoid
 * redundant API calls when several tickets change status in one tick.
 */
function createTicketMatcher(github) {
  let branchesCache = null;
  let pullsCache = null;
  let cachedAt = 0;
  const TTL_MS = 5000;

  async function branches() {
    const now = Date.now();
    if (!branchesCache || now - cachedAt > TTL_MS) {
      branchesCache = await github.listBranches();
      cachedAt = now;
    }
    return branchesCache;
  }

  async function pulls() {
    const now = Date.now();
    if (!pullsCache || now - cachedAt > TTL_MS) {
      pullsCache = await github.listOpenPulls();
      cachedAt = now;
    }
    return pullsCache;
  }

  function invalidate() {
    branchesCache = null;
    pullsCache = null;
  }

  async function findBranchForTicket(ticketKey) {
    const all = await branches();
    const match = all.find((b) => b.name.includes(ticketKey));
    return match ? match.name : null;
  }

  async function findOpenPrForTicket(ticketKey, { base } = {}) {
    const all = await pulls();
    const match = all.find(
      (pr) => pr.head.ref.includes(ticketKey) && (!base || pr.base.ref === base)
    );
    return match || null;
  }

  return { findBranchForTicket, findOpenPrForTicket, invalidate };
}

module.exports = { createTicketMatcher };
