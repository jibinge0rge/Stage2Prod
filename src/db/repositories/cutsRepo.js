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
  return {
    async insert({
      repoOwner,
      repoName,
      branchName,
      sha,
      stagingSha,
      previousSha = null,
      tickets = [],
      createdAt = new Date().toISOString(),
    }) {
      const { rows } = await db.query(
        `
        INSERT INTO production_cuts (
          repo_owner, repo_name, branch_name, sha, staging_sha, previous_sha, tickets_json, created_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8
        )
        RETURNING *
        `,
        [repoOwner, repoName, branchName, sha, stagingSha, previousSha, JSON.stringify(tickets), createdAt]
      );
      return rowToApi(rows[0]);
    },
    async list(owner, name) {
      const { rows } = await db.query(
        `
        SELECT * FROM production_cuts
        WHERE repo_owner = $1 AND repo_name = $2
        ORDER BY created_at DESC, id DESC
        `,
        [owner, name]
      );
      return rows.map(rowToApi);
    },
    async get(id) {
      const { rows } = await db.query('SELECT * FROM production_cuts WHERE id = $1', [id]);
      return rows[0] ? rowToApi(rows[0]) : null;
    },
    async getByBranch(owner, name, branchName) {
      const { rows } = await db.query(
        'SELECT * FROM production_cuts WHERE repo_owner = $1 AND repo_name = $2 AND branch_name = $3',
        [owner, name, branchName]
      );
      return rows[0] ? rowToApi(rows[0]) : null;
    },
    async update(id, { sha, previousSha = null, tickets = [] } = {}) {
      const { rows } = await db.query(
        `
        UPDATE production_cuts
        SET sha = $1, previous_sha = $2, tickets_json = $3
        WHERE id = $4
        RETURNING *
        `,
        [sha, previousSha, JSON.stringify(tickets), id]
      );
      return rows[0] ? rowToApi(rows[0]) : null;
    },
  };
}

module.exports = { createCutsRepo };
