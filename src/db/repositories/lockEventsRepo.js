function createLockEventsRepo(db) {
  return {
    async insertAcquire({ refName, acquiredAt, holder, correlationId, repoOwner = null, repoName = null }) {
      const { rows } = await db.query(
        `
        INSERT INTO lock_events (ref_name, acquired_at, holder, correlation_id, repo_owner, repo_name)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id
        `,
        [refName, acquiredAt, holder, correlationId ?? null, repoOwner, repoName]
      );
      return rows[0].id;
    },
    async recordRelease({ id, releasedAt, heldMs }) {
      await db.query('UPDATE lock_events SET released_at = $1, held_ms = $2 WHERE id = $3', [
        releasedAt,
        heldMs,
        id,
      ]);
    },
    async list(limit = 50) {
      const { rows } = await db.query('SELECT * FROM lock_events ORDER BY acquired_at DESC LIMIT $1', [limit]);
      return rows;
    },
  };
}

module.exports = { createLockEventsRepo };
