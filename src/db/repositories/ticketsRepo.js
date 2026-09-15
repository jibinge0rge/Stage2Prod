function createTicketsRepo(db) {
  /**
   * Merges an incoming (partial) ticket description with any existing
   * row so that a Jira-only refresh (poller upsert, which knows nothing
   * about branch/PR/pipeline/repo state) never clobbers fields only a
   * handler or the repo resolver knows how to set.
   */
  async function upsert(ticket) {
    const existing = await get(ticket.key);
    const now = new Date().toISOString();
    const params = {
      ticketKey: ticket.key,
      summary: ticket.summary ?? existing?.summary ?? null,
      jiraStatus: ticket.jiraStatus ?? existing?.jira_status,
      lastSeenStatus: ticket.lastSeenStatus ?? existing?.last_seen_status ?? ticket.jiraStatus,
      pipelineState: ticket.pipelineState ?? existing?.pipeline_state ?? 'unmerged',
      branchName: ticket.branchName ?? existing?.branch_name ?? null,
      prNumber: ticket.prNumber ?? existing?.pr_number ?? null,
      prState: ticket.prState ?? existing?.pr_state ?? null,
      checkStatus: ticket.checkStatus ?? existing?.check_status ?? null,
      headSha: ticket.headSha ?? existing?.head_sha ?? null,
      assigneeName: ticket.assigneeName ?? existing?.assignee_name ?? null,
      assigneeAvatarUrl: ticket.assigneeAvatarUrl ?? existing?.assignee_avatar_url ?? null,
      sprintName: ticket.sprintName ?? existing?.sprint_name ?? null,
      jiraUpdatedAt: ticket.jiraUpdatedAt ?? existing?.jira_updated_at ?? null,
      repoOwner: ticket.repoOwner ?? existing?.repo_owner ?? null,
      repoName: ticket.repoName ?? existing?.repo_name ?? null,
      updatedAt: now,
    };
    await db.query(
      `
      INSERT INTO tickets (
        ticket_key, summary, jira_status, last_seen_status, pipeline_state,
        branch_name, pr_number, pr_state, check_status, head_sha,
        assignee_name, assignee_avatar_url, sprint_name, jira_updated_at,
        repo_owner, repo_name, updated_at, created_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $17
      )
      ON CONFLICT(ticket_key) DO UPDATE SET
        summary = excluded.summary,
        jira_status = excluded.jira_status,
        last_seen_status = excluded.last_seen_status,
        pipeline_state = excluded.pipeline_state,
        branch_name = excluded.branch_name,
        pr_number = excluded.pr_number,
        pr_state = excluded.pr_state,
        check_status = excluded.check_status,
        head_sha = excluded.head_sha,
        assignee_name = excluded.assignee_name,
        assignee_avatar_url = excluded.assignee_avatar_url,
        sprint_name = excluded.sprint_name,
        jira_updated_at = excluded.jira_updated_at,
        repo_owner = excluded.repo_owner,
        repo_name = excluded.repo_name,
        updated_at = excluded.updated_at
      `,
      [
        params.ticketKey,
        params.summary,
        params.jiraStatus,
        params.lastSeenStatus,
        params.pipelineState,
        params.branchName,
        params.prNumber,
        params.prState,
        params.checkStatus,
        params.headSha,
        params.assigneeName,
        params.assigneeAvatarUrl,
        params.sprintName,
        params.jiraUpdatedAt,
        params.repoOwner,
        params.repoName,
        params.updatedAt,
      ]
    );
  }

  async function get(ticketKey) {
    const { rows } = await db.query('SELECT * FROM tickets WHERE ticket_key = $1', [ticketKey]);
    return rows[0] || null;
  }

  return {
    upsert,
    get,
    async list() {
      const { rows } = await db.query('SELECT * FROM tickets ORDER BY updated_at DESC');
      return rows;
    },
    async listByPipelineState(state) {
      const { rows } = await db.query(
        'SELECT * FROM tickets WHERE pipeline_state = $1 ORDER BY updated_at DESC',
        [state]
      );
      return rows;
    },
    async listByPipelineStateAndRepo(state, owner, name) {
      const { rows } = await db.query(
        'SELECT * FROM tickets WHERE pipeline_state = $1 AND repo_owner = $2 AND repo_name = $3 ORDER BY updated_at DESC',
        [state, owner, name]
      );
      return rows;
    },
    async listByJiraStatus(jiraStatus) {
      const { rows } = await db.query(
        'SELECT * FROM tickets WHERE jira_status = $1 ORDER BY updated_at DESC',
        [jiraStatus]
      );
      return rows;
    },
    async getLastSeenStatus(ticketKey) {
      const row = await get(ticketKey);
      return row ? row.last_seen_status : null;
    },
    async setPipelineState(ticketKey, pipelineState) {
      await db.query('UPDATE tickets SET pipeline_state = $1, updated_at = $2 WHERE ticket_key = $3', [
        pipelineState,
        new Date().toISOString(),
        ticketKey,
      ]);
    },
    async setLastSeenStatus(ticketKey, status) {
      await db.query(
        'UPDATE tickets SET last_seen_status = $1, jira_status = $2, updated_at = $3 WHERE ticket_key = $4',
        [status, status, new Date().toISOString(), ticketKey]
      );
    },
    async setGithubFacts(ticketKey, { branchName, prNumber, prState, checkStatus, headSha } = {}) {
      await db.query(
        `
        UPDATE tickets SET branch_name = COALESCE($1, branch_name),
          pr_number = COALESCE($2, pr_number), pr_state = COALESCE($3, pr_state),
          check_status = COALESCE($4, check_status), head_sha = COALESCE($5, head_sha),
          updated_at = $6
        WHERE ticket_key = $7
        `,
        [
          branchName ?? null,
          prNumber ?? null,
          prState ?? null,
          checkStatus ?? null,
          headSha ?? null,
          new Date().toISOString(),
          ticketKey,
        ]
      );
    },
    async setCheckStatus(ticketKey, checkStatus) {
      await db.query('UPDATE tickets SET check_status = $1, updated_at = $2 WHERE ticket_key = $3', [
        checkStatus,
        new Date().toISOString(),
        ticketKey,
      ]);
    },
    async setRepo(ticketKey, owner, name) {
      await db.query('UPDATE tickets SET repo_owner = $1, repo_name = $2, updated_at = $3 WHERE ticket_key = $4', [
        owner,
        name,
        new Date().toISOString(),
        ticketKey,
      ]);
    },
    async setAssignee(ticketKey, { name = null, avatarUrl = null } = {}) {
      await db.query(
        'UPDATE tickets SET assignee_name = $1, assignee_avatar_url = $2, updated_at = $3 WHERE ticket_key = $4',
        [name, avatarUrl, new Date().toISOString(), ticketKey]
      );
    },
    // Plain SET, not COALESCE — unlike setGithubFacts (used for "here's a
    // new/updated fact"), this is for "the PR this ticket pointed at is
    // gone, stop showing it as if it still exists" (e.g. a closed/deleted
    // PR discovered during a merge attempt). branch_name is left alone:
    // it's still useful context (the name to recreate), not stale/wrong.
    async clearGithubFacts(ticketKey) {
      await db.query(
        `
        UPDATE tickets SET pr_number = NULL, pr_state = NULL, check_status = NULL, head_sha = NULL, updated_at = $1
        WHERE ticket_key = $2
        `,
        [new Date().toISOString(), ticketKey]
      );
    },
    // Feature branch (and PR) are gone on GitHub — wipe the local git
    // pointer including branch_name so Create branch is offered again.
    async clearFeatureWork(ticketKey) {
      await db.query(
        `
        UPDATE tickets SET
          branch_name = NULL, pr_number = NULL, pr_state = NULL,
          check_status = NULL, head_sha = NULL, pipeline_state = $1, updated_at = $2
        WHERE ticket_key = $3
        `,
        ['unmerged', new Date().toISOString(), ticketKey]
      );
    },
  };
}

module.exports = { createTicketsRepo };
