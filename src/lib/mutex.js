const { Mutex } = require('async-mutex');
const { logger } = require('./logger');

// Ref keys are namespaced per repo as "owner/name#refs/heads/staging"
// (see lib/constants.js's refKey). Parsed back out here purely so
// lock_events rows can carry repo_owner/repo_name columns without the
// mutex's own public API needing to know about "repos" as a concept.
function parseRefKey(refName) {
  const hashIndex = refName.indexOf('#');
  if (hashIndex === -1) return { repoOwner: null, repoName: null };
  const [owner, name] = refName.slice(0, hashIndex).split('/');
  return { repoOwner: owner || null, repoName: name || null };
}

class LockHeldError extends Error {
  constructor(refName, holder, heldMs) {
    super(`ref ${refName} is currently locked by ${holder}`);
    this.name = 'LockHeldError';
    this.refName = refName;
    this.holder = holder;
    this.heldMs = heldMs;
  }
}

/**
 * One async-mutex per git ref name, so writes to the same ref serialize
 * while writes to different refs (e.g. staging vs develop) run in parallel.
 * Every acquire/release is recorded (in-memory snapshot for /api/health,
 * and — when a lockEventsRepo is attached — a persisted lock_events row).
 */
class RefLockManager {
  constructor() {
    this._mutexes = new Map(); // refName -> Mutex
    this._state = new Map(); // refName -> { locked, holder, acquiredAt, correlationId }
    this._lockEventsRepo = null;
  }

  attachRepo(lockEventsRepo) {
    this._lockEventsRepo = lockEventsRepo;
  }

  _getMutex(refName) {
    if (!this._mutexes.has(refName)) this._mutexes.set(refName, new Mutex());
    return this._mutexes.get(refName);
  }

  _recordAcquire(refName, holder, correlationId) {
    const acquiredAt = new Date().toISOString();
    this._state.set(refName, { locked: true, holder, acquiredAt, correlationId });
    logger.info({ refName, holder, correlationId }, 'ref lock acquired');
    let lockEventId = null;
    if (this._lockEventsRepo) {
      const { repoOwner, repoName } = parseRefKey(refName);
      lockEventId = this._lockEventsRepo.insertAcquire({ refName, holder, acquiredAt, correlationId, repoOwner, repoName });
    }
    return { acquiredAt, lockEventId };
  }

  _recordRelease(refName, holder, correlationId, acquiredAt, lockEventId) {
    const releasedAt = new Date().toISOString();
    const heldMs = Date.now() - new Date(acquiredAt).getTime();
    this._state.set(refName, { locked: false, holder: null, acquiredAt: null, correlationId: null });
    logger.info({ refName, holder, correlationId, heldMs }, 'ref lock released');
    if (this._lockEventsRepo && lockEventId != null) {
      this._lockEventsRepo.recordRelease({ id: lockEventId, releasedAt, heldMs });
    }
  }

  /**
   * Blocking acquire — waits its turn. Used by poller-driven handlers.
   */
  async withLock(refName, holder, correlationId, fn) {
    const mutex = this._getMutex(refName);
    return mutex.runExclusive(async () => {
      const { acquiredAt, lockEventId } = this._recordAcquire(refName, holder, correlationId);
      try {
        return await fn();
      } finally {
        this._recordRelease(refName, holder, correlationId, acquiredAt, lockEventId);
      }
    });
  }

  /**
   * Non-blocking acquire — throws LockHeldError immediately if the ref is
   * already locked, rather than queueing. Used by POST /api/staging/reset.
   */
  async withLockOrReject(refName, holder, correlationId, fn) {
    const mutex = this._getMutex(refName);
    if (mutex.isLocked()) {
      const current = this._state.get(refName) || {};
      const heldMs = current.acquiredAt ? Date.now() - new Date(current.acquiredAt).getTime() : null;
      throw new LockHeldError(refName, current.holder, heldMs);
    }
    return this.withLock(refName, holder, correlationId, fn);
  }

  /**
   * Returns the state of every ref key touched at least once. `extraKeys`
   * lets a caller (e.g. the health route, which knows the full set of
   * currently-watched repos) merge in keys that exist but have never been
   * locked yet, so they still show up as "idle" rather than being absent.
   */
  snapshot(extraKeys = []) {
    const refs = new Set([...this._mutexes.keys(), ...extraKeys]);
    return [...refs].map((ref) => {
      const s = this._state.get(ref) || { locked: false, holder: null, acquiredAt: null };
      const heldMs = s.locked && s.acquiredAt ? Date.now() - new Date(s.acquiredAt).getTime() : null;
      return { ref, locked: !!s.locked, holder: s.holder || null, acquiredAt: s.acquiredAt || null, heldMs };
    });
  }
}

module.exports = { RefLockManager, LockHeldError, lockManager: new RefLockManager() };
