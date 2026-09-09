function createEventsRepo(db) {
  const insertStmt = db.prepare(`
    INSERT INTO events (timestamp, correlation_id, ticket_key, trigger_label, action, outcome, title, detail, metadata_json, repo_owner, repo_name)
    VALUES (@timestamp, @correlationId, @ticketKey, @trigger, @action, @outcome, @title, @detail, @metadataJson, @repoOwner, @repoName)
  `);

  function rowToApi(row) {
    return {
      id: row.id,
      timestamp: row.timestamp,
      ticketKey: row.ticket_key,
      trigger: row.trigger_label,
      action: row.action,
      outcome: row.outcome,
      title: row.title,
      detail: row.detail,
      correlationId: row.correlation_id,
      metadata: row.metadata_json ? JSON.parse(row.metadata_json) : null,
      repo: row.repo_owner ? { owner: row.repo_owner, name: row.repo_name } : null,
    };
  }

  return {
    insertEvent({
      ticketKey = null,
      trigger,
      action,
      outcome,
      title,
      detail = null,
      correlationId = null,
      metadata = null,
      repoOwner = null,
      repoName = null,
    }) {
      const info = insertStmt.run({
        timestamp: new Date().toISOString(),
        correlationId,
        ticketKey,
        trigger,
        action,
        outcome,
        title,
        detail,
        metadataJson: metadata ? JSON.stringify(metadata) : null,
        repoOwner,
        repoName,
      });
      return info.lastInsertRowid;
    },

    list({ ticketKey, outcome, since, repo, limit = 50, offset = 0 } = {}) {
      const clauses = [];
      const params = {};
      if (ticketKey) { clauses.push('ticket_key = @ticketKey'); params.ticketKey = ticketKey; }
      if (outcome) { clauses.push('outcome = @outcome'); params.outcome = outcome; }
      if (since) { clauses.push('timestamp >= @since'); params.since = since; }
      if (repo) {
        const [repoOwner, repoName] = String(repo).split('/');
        clauses.push('repo_owner = @repoOwner AND repo_name = @repoName');
        params.repoOwner = repoOwner;
        params.repoName = repoName;
      }
      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
      params.limit = limit;
      params.offset = offset;
      const rows = db
        .prepare(`SELECT * FROM events ${where} ORDER BY timestamp DESC, id DESC LIMIT @limit OFFSET @offset`)
        .all(params);
      const total = db.prepare(`SELECT COUNT(*) AS c FROM events ${where}`).get(params).c;
      return { events: rows.map(rowToApi), total };
    },

    timelineForTicket(ticketKey) {
      const rows = db
        .prepare('SELECT * FROM events WHERE ticket_key = ? ORDER BY timestamp ASC, id ASC')
        .all(ticketKey);
      return rows.map((r) => ({ title: r.title, detail: r.detail, timestamp: r.timestamp }));
    },

    countMergedToday(now = new Date()) {
      const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
      const row = db
        .prepare("SELECT action, COUNT(*) as c FROM events WHERE outcome = 'MERGED' AND timestamp >= ? GROUP BY action")
        .all(startOfDay);
      let toDevelop = 0;
      let toStaging = 0;
      for (const r of row) {
        if (r.action === 'merge:develop') toDevelop += r.c;
        else if (r.action === 'merge:staging') toStaging += r.c;
      }
      return { total: toDevelop + toStaging, toDevelop, toStaging };
    },
  };
}

module.exports = { createEventsRepo };
