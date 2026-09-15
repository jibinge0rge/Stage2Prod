const {
  normalizeStatusHandlerMap,
  effectiveStatusHandlerMap,
} = require('../../lib/statusHandlerMap');
const { normalizeTeamRoles, parseStoredTeamRoles, emptyTeamRoles } = require('../../lib/teamRoles');

function createReposRepo(db) {
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

  async function get(owner, name) {
    const { rows } = await db.query('SELECT * FROM repos WHERE owner = $1 AND name = $2', [owner, name]);
    return rows[0] ? rowToApi(rows[0]) : null;
  }

  return {
    get,
    async isActive(owner, name) {
      const { rows } = await db.query('SELECT * FROM repos WHERE owner = $1 AND name = $2', [owner, name]);
      return !!rows[0] && !!rows[0].active;
    },
    async list({ activeOnly = true } = {}) {
      const { rows } = await db.query(
        activeOnly
          ? 'SELECT * FROM repos WHERE active = 1 ORDER BY added_at ASC'
          : 'SELECT * FROM repos ORDER BY added_at ASC'
      );
      return rows.map(rowToApi);
    },
    // Note: the ON CONFLICT clause below intentionally does not touch
    // production_branch/staging_branch/jira_project_key/status_handler_map/
    // team_roles, so re-watching a previously removed repo keeps whatever
    // config it had before, not these defaults.
    async add(owner, name, {
      productionBranch = 'develop',
      stagingBranch = 'staging',
      jiraProjectKey = null,
      statusHandlerMap = undefined,
      teamRoles = undefined,
    } = {}) {
      const normalized = statusHandlerMap === undefined ? null : normalizeStatusHandlerMap(statusHandlerMap);
      const roles =
        teamRoles === undefined ? null : JSON.stringify(normalizeTeamRoles(teamRoles) || emptyTeamRoles());
      await db.query(
        `
        INSERT INTO repos (owner, name, active, added_at, production_branch, staging_branch, jira_project_key, status_handler_map, team_roles)
        VALUES ($1, $2, 1, $3, $4, $5, $6, $7, $8)
        ON CONFLICT(owner, name) DO UPDATE SET active = 1, removed_at = NULL, added_at = $3
        `,
        [
          owner,
          name,
          new Date().toISOString(),
          productionBranch,
          stagingBranch,
          jiraProjectKey || null,
          normalized ? JSON.stringify(normalized) : null,
          roles,
        ]
      );
      return get(owner, name);
    },
    // productionBranch/stagingBranch are COALESCE-style (omit to leave
    // unchanged; a branch name can never be intentionally cleared).
    // jiraProjectKey / statusHandlerMap / teamRoles are different — a repo
    // can legitimately have none, so `undefined` means "leave unchanged"
    // while `null`/`''` / `{}` means "clear back to defaults".
    async update(owner, name, { productionBranch, stagingBranch, jiraProjectKey, statusHandlerMap, teamRoles } = {}) {
      const current = await get(owner, name);
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

      await db.query(
        `
        UPDATE repos SET
          production_branch = COALESCE($1, production_branch),
          staging_branch = COALESCE($2, staging_branch),
          jira_project_key = $3,
          status_handler_map = $4,
          team_roles = $5
        WHERE owner = $6 AND name = $7
        `,
        [productionBranch ?? null, stagingBranch ?? null, nextJiraProjectKey, nextMapJson, nextTeamRolesJson, owner, name]
      );
      return get(owner, name);
    },
    async remove(owner, name) {
      await db.query('UPDATE repos SET active = 0, removed_at = $1 WHERE owner = $2 AND name = $3', [
        new Date().toISOString(),
        owner,
        name,
      ]);
    },
  };
}

module.exports = { createReposRepo };
