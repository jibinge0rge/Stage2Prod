const { createGithubClient } = require('./github');

/**
 * One (dry-run-wrapped) GitHubClient per watched repo, cached by
 * "owner/name". All share the same token from config — only the repo
 * differs between watched repos — and all share one rateLimit object,
 * since GitHub's rate limit is per-token, not per-repo: whichever repo's
 * request happened most recently reflects the account's real remaining
 * quota for every other repo too.
 */
function createGithubClientRegistry(config) {
  const cache = new Map();
  const sharedRateLimit = { remaining: null, limit: null, resetAt: null };

  function getClient(owner, name) {
    const key = `${owner}/${name}`;
    if (!cache.has(key)) {
      cache.set(key, createGithubClient(config, { owner, repo: name, sharedRateLimit }));
    }
    return cache.get(key);
  }

  function evict(owner, name) {
    cache.delete(`${owner}/${name}`);
  }

  return { getClient, evict, rateLimit: sharedRateLimit };
}

module.exports = { createGithubClientRegistry };
