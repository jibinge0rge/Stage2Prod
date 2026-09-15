function createCursorRepo(db) {
  async function get() {
    const { rows } = await db.query('SELECT * FROM poll_state WHERE id = 1');
    return rows[0];
  }

  return {
    get,
    async getCursor() {
      const row = await get();
      return row.cursor;
    },
    async setCursor(cursor) {
      await db.query('UPDATE poll_state SET cursor = $1 WHERE id = 1', [cursor]);
    },
    async recordPoll({ ok, error = null }) {
      await db.query('UPDATE poll_state SET last_poll_at = $1, last_poll_ok = $2, last_error = $3 WHERE id = 1', [
        new Date().toISOString(),
        ok ? 1 : 0,
        error,
      ]);
    },
    async setJiraRateLimit({ remaining, resetAt }) {
      await db.query(
        'UPDATE poll_state SET jira_rate_limit_remaining = $1, jira_rate_limit_reset_at = $2 WHERE id = 1',
        [remaining ?? null, resetAt ?? null]
      );
    },
  };
}

module.exports = { createCursorRepo };
