function createReposRepo(db) {
  const getStmt = db.prepare('SELECT * FROM repos WHERE owner = ? AND name = ?');
  const listActiveStmt = db.prepare('SELECT * FROM repos WHERE active = 1 ORDER BY added_at ASC');
  const listAllStmt = db.prepare('SELECT * FROM repos ORDER BY added_at ASC');
  const insertStmt = db.prepare(`
    INSERT INTO repos (owner, name, active, added_at, production_branch, staging_branch, jira_project_key)
    VALUES (@owner, @name, 1, @addedAt, @productionBranch, @stagingBranch, @jiraProjectKey)
    ON CONFLICT(owner, name) DO UPDATE SET active = 1, removed_at = NULL, added_at = @addedAt
  `);
  const removeStmt = db.prepare('UPDATE repos SET active = 0, removed_at = ? WHERE owner = ? AND name = ?');
  const updateStmt = db.prepare(`
    UPDATE repos SET
      production_branch = COALESCE(?, production_branch),
      staging_branch = COALESCE(?, staging_branch),
      jira_project_key = ?
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
      jiraProjectKey: row.jira_project_key,
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
    // production_branch/staging_branch/jira_project_key, so re-watching a
    // previously removed repo keeps whatever config it had before, not
    // these defaults.
    add(owner, name, { productionBranch = 'develop', stagingBranch = 'staging', jiraProjectKey = null } = {}) {
      insertStmt.run({ owner, name, addedAt: new Date().toISOString(), productionBranch, stagingBranch, jiraProjectKey: jiraProjectKey || null });
      return this.get(owner, name);
    },
    // productionBranch/stagingBranch are COALESCE-style (omit to leave
    // unchanged; a branch name can never be intentionally cleared).
    // jiraProjectKey is different — a repo can legitimately have none, so
    // `undefined` here means "leave unchanged" while `null`/`''` means
    // "clear it", resolved in JS before the UPDATE rather than via SQL
    // COALESCE (which can't distinguish "not given" from "clear to null").
    update(owner, name, { productionBranch, stagingBranch, jiraProjectKey } = {}) {
      const current = this.get(owner, name);
      const nextJiraProjectKey = jiraProjectKey === undefined ? current?.jiraProjectKey ?? null : jiraProjectKey || null;
      updateStmt.run(productionBranch ?? null, stagingBranch ?? null, nextJiraProjectKey, owner, name);
      return this.get(owner, name);
    },
    remove(owner, name) {
      removeStmt.run(new Date().toISOString(), owner, name);
    },
  };
}

module.exports = { createReposRepo };
