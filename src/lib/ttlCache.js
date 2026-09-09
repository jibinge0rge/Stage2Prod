/**
 * Wraps the named read methods of a client so repeated calls with the
 * same arguments within `ttlMs` reuse the last result instead of hitting
 * the real API again. Exists because switching tabs in the UI re-fetches
 * /api/branches and /api/untracked on every mount, and each of those
 * makes several GitHub round trips per watched repo — without this,
 * quick tab-switching pays that full upstream latency every time.
 */
function wrapWithTtlCache(client, methodNames, ttlMs) {
  const wrapped = Object.create(client);
  for (const method of methodNames) {
    const original = client[method];
    if (typeof original !== 'function') continue;
    const cache = new Map(); // argsKey -> { at, promise }
    wrapped[method] = (...args) => {
      const key = JSON.stringify(args);
      const cached = cache.get(key);
      if (cached && Date.now() - cached.at < ttlMs) return cached.promise;
      const promise = original.apply(client, args);
      // A rejected call shouldn't be remembered as the cached answer —
      // let the next call retry against the real API instead of
      // replaying the same failure for the rest of the TTL window.
      promise.catch(() => cache.delete(key));
      cache.set(key, { at: Date.now(), promise });
      return promise;
    };
  }
  return wrapped;
}

module.exports = { wrapWithTtlCache };
