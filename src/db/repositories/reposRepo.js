const {
  normalizeStatusHandlerMap,
  effectiveStatusHandlerMap,
} = require('../../lib/statusHandlerMap');
const { normalizeTeamRoles, parseStoredTeamRoles, emptyTeamRoles } = require('../../lib/teamRoles');

function createReposRepo(db) {
  const getStmt = db.prepare('SELECT * FROM repos WHERE owner = ? AND name = ?');
  const listActiveStmt = db.prepare('SELECT * FROM repos WHERE active = 1 ORDER BY added_at ASC');
  const listAllStmt = db.prepare('SELECT * FROM repos ORDER BY added_at ASC');
  const insertStmt = db.prepare(`
    INSERT INTO repos (owner, name, active, added_at, production_branch, staging_branch, jira_project_key, status_handler_map, team_roles)
    VALUES (@owner, @name, 1, @addedAt, @productionBranch, @stagingBranch, @jiraProjectKey, @statusHandlerMap, @teamRoles)
    ON CONFLICT(owner, name) DO UPDATE SET active = 1, removed_at = NULL, added_at = @addedAt
  `);
  const removeStmt = db.prepare('UPDATE repos SET active = 0, removed_at = ? WHERE owner = ? AND name = ?');
  const updateStmt = db.prepare(`
    UPDATE repos SET
      production_branch = COALESCE(?, production_branch),
      staging_branch = COALESCE(?, staging_branch),
      jira_project_key = ?,
      status_handler_map = ?,
      team_roles = ?
    WHERE owner = ? AND name = ?
  `);

  function parseStoredMap(json) {
    if (!json) return null;
    try {
      return normalizeStatusHandlerMap(JSON.parse(json));
    } catch {
      return null;
    }
  }

  function rowToApi(row) {
    const statusHandlerMap = parseStoredMap(row.status_handler_map);
    return {
      owner: row.owner,
      name: row.name,
      active: !!row.active,
      addedAt: row.added_at,
      removedAt: row.removed_at,
      productionBranch: row.production_branch,
      stagingBranch: row.staging_branch,
      jiraProjectKey: row.jira_project_key,
      statusHandlerMap,
      effectiveStatusHandlerMap: effectiveStatusHandlerMap(statusHandlerMap),
      teamRoles: parseStoredTeamRoles(row.team_roles),
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
    // production_branch/staging_branch/jira_project_key/status_handler_map/
    // team_roles, so re-watching a previously removed repo keeps whatever
    // config it had before, not these defaults.
    add(owner, name, {
      productionBranch = 'develop',
      stagingBranch = 'staging',
      jiraProjectKey = null,
      statusHandlerMap = undefined,
      teamRoles = undefined,
    } = {}) {
      const normalized = statusHandlerMap === undefined ? null : normalizeStatusHandlerMap(statusHandlerMap);
      const roles =
        teamRoles === undefined ? null : JSON.stringify(normalizeTeamRoles(teamRoles) || emptyTeamRoles());
      insertStmt.run({
        owner,
        name,
        addedAt: new Date().toISOString(),
        productionBranch,
        stagingBranch,
        jiraProjectKey: jiraProjectKey || null,
        statusHandlerMap: normalized ? JSON.stringify(normalized) : null,
        teamRoles: roles,
      });
      return this.get(owner, name);
    },
    // productionBranch/stagingBranch are COALESCE-style (omit to leave
    // unchanged; a branch name can never be intentionally cleared).
    // jiraProjectKey / statusHandlerMap / teamRoles are different — a repo
    // can legitimately have none, so `undefined` means "leave unchanged"
    // while `null`/`''` / `{}` means "clear back to defaults".
    update(owner, name, { productionBranch, stagingBranch, jiraProjectKey, statusHandlerMap, teamRoles } = {}) {
      const current = this.get(owner, name);
      const nextJiraProjectKey = jiraProjectKey === undefined ? current?.jiraProjectKey ?? null : jiraProjectKey || null;
      let nextMapJson;
      if (statusHandlerMap === undefined) {
        nextMapJson = current?.statusHandlerMap ? JSON.stringify(current.statusHandlerMap) : null;
      } else if (statusHandlerMap === null || statusHandlerMap === '') {
        nextMapJson = null;
      } else {
        const normalized = normalizeStatusHandlerMap(statusHandlerMap);
        nextMapJson = normalized ? JSON.stringify(normalized) : null;
      }

      let nextTeamRolesJson;
      if (teamRoles === undefined) {
        nextTeamRolesJson = current?.teamRoles ? JSON.stringify(current.teamRoles) : null;
      } else if (teamRoles === null || teamRoles === '') {
        nextTeamRolesJson = null;
      } else {
        nextTeamRolesJson = JSON.stringify(normalizeTeamRoles(teamRoles));
      }

      updateStmt.run(
        productionBranch ?? null,
        stagingBranch ?? null,
        nextJiraProjectKey,
        nextMapJson,
        nextTeamRolesJson,
        owner,
        name
      );
      return this.get(owner, name);
    },
    remove(owner, name) {
      removeStmt.run(new Date().toISOString(), owner, name);
    },
  };
}

module.exports = { createReposRepo };
