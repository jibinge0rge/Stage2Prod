function createCursorRepo(db) {
  const getStmt = db.prepare('SELECT * FROM poll_state WHERE id = 1');
  const setCursorStmt = db.prepare('UPDATE poll_state SET cursor = ? WHERE id = 1');
  const recordPollStmt = db.prepare(`
    UPDATE poll_state SET last_poll_at = ?, last_poll_ok = ?, last_error = ? WHERE id = 1
  `);
  const setJiraRateLimitStmt = db.prepare(`
    UPDATE poll_state SET jira_rate_limit_remaining = ?, jira_rate_limit_reset_at = ? WHERE id = 1
  `);

  return {
    get() {
      return getStmt.get();
    },
    getCursor() {
      return getStmt.get().cursor;
    },
    setCursor(cursor) {
      setCursorStmt.run(cursor);
    },
    recordPoll({ ok, error = null }) {
      recordPollStmt.run(new Date().toISOString(), ok ? 1 : 0, error);
    },
    setJiraRateLimit({ remaining, resetAt }) {
      setJiraRateLimitStmt.run(remaining ?? null, resetAt ?? null);
    },
  };
}

module.exports = { createCursorRepo };
