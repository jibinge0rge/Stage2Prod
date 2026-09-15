function createEventsRepo(db) {
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
    async insertEvent({
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
      const { rows } = await db.query(
        `
        INSERT INTO events (timestamp, correlation_id, ticket_key, trigger_label, action, outcome, title, detail, metadata_json, repo_owner, repo_name)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING id
        `,
        [
          new Date().toISOString(),
          correlationId,
          ticketKey,
          trigger,
          action,
          outcome,
          title,
          detail,
          metadata ? JSON.stringify(metadata) : null,
          repoOwner,
          repoName,
        ]
      );
      return rows[0].id;
    },

    async list({ ticketKey, outcome, since, repo, limit = 50, offset = 0 } = {}) {
      const clauses = [];
      const params = [];
      if (ticketKey) { params.push(ticketKey); clauses.push(`ticket_key = $${params.length}`); }
      if (outcome) { params.push(outcome); clauses.push(`outcome = $${params.length}`); }
      if (since) { params.push(since); clauses.push(`timestamp >= $${params.length}`); }
      if (repo) {
        const [repoOwner, repoName] = String(repo).split('/');
        params.push(repoOwner);
        const ownerIdx = params.length;
        params.push(repoName);
        const nameIdx = params.length;
        clauses.push(`repo_owner = $${ownerIdx} AND repo_name = $${nameIdx}`);
      }
      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
      const limitIdx = params.push(limit);
      const offsetIdx = params.push(offset);
      const { rows } = await db.query(
        `SELECT * FROM events ${where} ORDER BY timestamp DESC, id DESC LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
        params
      );
      const countParams = params.slice(0, params.length - 2);
      const { rows: countRows } = await db.query(`SELECT COUNT(*) AS c FROM events ${where}`, countParams);
      return { events: rows.map(rowToApi), total: Number(countRows[0].c) };
    },

    async timelineForTicket(ticketKey) {
      const { rows } = await db.query(
        'SELECT * FROM events WHERE ticket_key = $1 ORDER BY timestamp ASC, id ASC',
        [ticketKey]
      );
      return rows.map((r) => ({ title: r.title, detail: r.detail, timestamp: r.timestamp }));
    },

    async countMergedToday(now = new Date()) {
      const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
      const { rows } = await db.query(
        "SELECT action, COUNT(*) as c FROM events WHERE outcome = 'MERGED' AND timestamp >= $1 GROUP BY action",
        [startOfDay]
      );
      let toDevelop = 0;
      let toStaging = 0;
      for (const r of rows) {
        const c = Number(r.c);
        if (r.action === 'merge:develop') toDevelop += c;
        else if (r.action === 'merge:staging') toStaging += c;
      }
      return { total: toDevelop + toStaging, toDevelop, toStaging };
    },
  };
}

module.exports = { createEventsRepo };
