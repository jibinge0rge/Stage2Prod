function createLockEventsRepo(db) {
  const insertStmt = db.prepare(`
    INSERT INTO lock_events (ref_name, acquired_at, holder, correlation_id, repo_owner, repo_name)
    VALUES (@refName, @acquiredAt, @holder, @correlationId, @repoOwner, @repoName)
  `);
  const releaseStmt = db.prepare('UPDATE lock_events SET released_at = ?, held_ms = ? WHERE id = ?');
  const listStmt = db.prepare('SELECT * FROM lock_events ORDER BY acquired_at DESC LIMIT ?');

  return {
    insertAcquire({ refName, acquiredAt, holder, correlationId, repoOwner = null, repoName = null }) {
      const info = insertStmt.run({
        refName,
        acquiredAt,
        holder,
        correlationId: correlationId ?? null,
        repoOwner,
        repoName,
      });
      return info.lastInsertRowid;
    },
    recordRelease({ id, releasedAt, heldMs }) {
      releaseStmt.run(releasedAt, heldMs, id);
    },
    list(limit = 50) {
      return listStmt.all(limit);
    },
  };
}

module.exports = { createLockEventsRepo };
