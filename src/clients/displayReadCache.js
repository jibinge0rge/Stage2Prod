const { wrapWithTtlCache } = require('../lib/ttlCache');

// Overview/Staging-sandbox/Untracked-changes all re-fetch on every tab
// switch; this only needs to survive a burst of quick navigation, not
// mask real staleness — the poller (default 60s) still sees live state
// on its own next tick regardless of this cache.
const TTL_MS = 10000;
const CACHED_METHODS = ['listBranches', 'listOpenPulls', 'getRef', 'compareCommits', 'listCommitsAhead'];

/**
 * A read-cached view of repoResolver's per-repo GitHub clients, handed
 * only to GET routes that just display state (/api/branches,
 * /api/untracked). Handlers that decide whether to merge/reset a branch
 * always go through repoResolver.getClient directly instead — never
 * this — so a stale read here can never cause a wrong git write; worst
 * case a dashboard tab is up to TTL_MS stale, which self-corrects on the
 * next fetch.
 */
function createDisplayGithubClients(repoResolver) {
  const cache = new Map();

  function getClient(owner, name) {
    const key = `${owner}/${name}`;
    if (!cache.has(key)) {
      cache.set(key, wrapWithTtlCache(repoResolver.getClient(owner, name), CACHED_METHODS, TTL_MS));
    }
    return cache.get(key);
  }

  return { getClient };
}

module.exports = { createDisplayGithubClients };
