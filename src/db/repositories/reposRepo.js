function createReposRepo(db) {
  const getStmt = db.prepare('SELECT * FROM repos WHERE owner = ? AND name = ?');
  const listActiveStmt = db.prepare('SELECT * FROM repos WHERE active = 1 ORDER BY added_at ASC');
  const listAllStmt = db.prepare('SELECT * FROM repos ORDER BY added_at ASC');
  const insertStmt = db.prepare(`
    INSERT INTO repos (owner, name, active, added_at, production_branch, staging_branch)
    VALUES (@owner, @name, 1, @addedAt, @productionBranch, @stagingBranch)
    ON CONFLICT(owner, name) DO UPDATE SET active = 1, removed_at = NULL, added_at = @addedAt
  `);
  const removeStmt = db.prepare('UPDATE repos SET active = 0, removed_at = ? WHERE owner = ? AND name = ?');
  const updateBranchesStmt = db.prepare(`
    UPDATE repos SET production_branch = COALESCE(?, production_branch), staging_branch = COALESCE(?, staging_branch)
    WHERE owner = ? AND name = ?
  `);

  function rowToApi(row) {
    return {
      owner: row.owner,
      name: row.name,
      active: !!row.active,
      addedAt: row.added_at,
      removedAt: row.removed_at,
      productionBranch: row.production_branch,
      stagingBranch: row.staging_branch,
    };
  }

  return {
    get(owner, name) {
      const row = getStmt.get(owner, name);
      return row ? rowToApi(row) : null;
    },
    isActive(owner, name) {
      const row = getStmt.get(owner, name);
      return !!row && !!row.active;
    },
    list({ activeOnly = true } = {}) {
      const rows = (activeOnly ? listActiveStmt : listAllStmt).all();
      return rows.map(rowToApi);
    },
    // Note: the ON CONFLICT clause above intentionally does not touch
    // production_branch/staging_branch, so re-watching a previously
    // removed repo keeps whatever branch names it had, not these defaults.
    add(owner, name, { productionBranch = 'develop', stagingBranch = 'staging' } = {}) {
      insertStmt.run({ owner, name, addedAt: new Date().toISOString(), productionBranch, stagingBranch });
      return this.get(owner, name);
    },
    update(owner, name, { productionBranch, stagingBranch } = {}) {
      updateBranchesStmt.run(productionBranch ?? null, stagingBranch ?? null, owner, name);
      return this.get(owner, name);
    },
    remove(owner, name) {
      removeStmt.run(new Date().toISOString(), owner, name);
    },
  };
}

module.exports = { createReposRepo };
