function parseTickets(json) {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function rowToApi(row) {
  return {
    id: row.id,
    repoOwner: row.repo_owner,
    repoName: row.repo_name,
    branchName: row.branch_name,
    sha: row.sha,
    stagingSha: row.staging_sha,
    previousSha: row.previous_sha,
    tickets: parseTickets(row.tickets_json),
    createdAt: row.created_at,
  };
}

function createCutsRepo(db) {
  const insertStmt = db.prepare(`
    INSERT INTO production_cuts (
      repo_owner, repo_name, branch_name, sha, staging_sha, previous_sha, tickets_json, created_at
    ) VALUES (
      @repoOwner, @repoName, @branchName, @sha, @stagingSha, @previousSha, @ticketsJson, @createdAt
    )
  `);
  const listStmt = db.prepare(`
    SELECT * FROM production_cuts
    WHERE repo_owner = ? AND repo_name = ?
    ORDER BY created_at DESC, id DESC
  `);
  const getStmt = db.prepare('SELECT * FROM production_cuts WHERE id = ?');
  const getByBranchStmt = db.prepare(`
    SELECT * FROM production_cuts WHERE repo_owner = ? AND repo_name = ? AND branch_name = ?
  `);
  const updateStmt = db.prepare(`
    UPDATE production_cuts
    SET sha = ?, previous_sha = ?, tickets_json = ?
    WHERE id = ?
  `);

  return {
    insert({
      repoOwner,
      repoName,
      branchName,
      sha,
      stagingSha,
      previousSha = null,
      tickets = [],
      createdAt = new Date().toISOString(),
    }) {
      const info = insertStmt.run({
        repoOwner,
        repoName,
        branchName,
        sha,
        stagingSha,
        previousSha,
        ticketsJson: JSON.stringify(tickets),
        createdAt,
      });
      return this.get(info.lastInsertRowid);
    },
    list(owner, name) {
      return listStmt.all(owner, name).map(rowToApi);
    },
    get(id) {
      const row = getStmt.get(id);
      return row ? rowToApi(row) : null;
    },
    getByBranch(owner, name, branchName) {
      const row = getByBranchStmt.get(owner, name, branchName);
      return row ? rowToApi(row) : null;
    },
    update(id, { sha, previousSha = null, tickets = [] } = {}) {
      updateStmt.run(sha, previousSha, JSON.stringify(tickets), id);
      return this.get(id);
    },
  };
}

module.exports = { createCutsRepo };
