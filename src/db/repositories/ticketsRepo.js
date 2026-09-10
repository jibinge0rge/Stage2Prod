function createTicketsRepo(db) {
  const upsertStmt = db.prepare(`
    INSERT INTO tickets (
      ticket_key, summary, jira_status, last_seen_status, pipeline_state,
      branch_name, pr_number, pr_state, check_status, head_sha,
      assignee_name, assignee_avatar_url, sprint_name, jira_updated_at,
      repo_owner, repo_name, updated_at, created_at
    ) VALUES (
      @ticketKey, @summary, @jiraStatus, @lastSeenStatus, @pipelineState,
      @branchName, @prNumber, @prState, @checkStatus, @headSha,
      @assigneeName, @assigneeAvatarUrl, @sprintName, @jiraUpdatedAt,
      @repoOwner, @repoName, @updatedAt, @updatedAt
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
  `);

  const getStmt = db.prepare('SELECT * FROM tickets WHERE ticket_key = ?');
  const listStmt = db.prepare('SELECT * FROM tickets ORDER BY updated_at DESC');
  const listByStateStmt = db.prepare('SELECT * FROM tickets WHERE pipeline_state = ? ORDER BY updated_at DESC');
  const listByStateAndRepoStmt = db.prepare(
    'SELECT * FROM tickets WHERE pipeline_state = ? AND repo_owner = ? AND repo_name = ? ORDER BY updated_at DESC'
  );
  const listByJiraStatusStmt = db.prepare('SELECT * FROM tickets WHERE jira_status = ? ORDER BY updated_at DESC');
  const setPipelineStateStmt = db.prepare(
    'UPDATE tickets SET pipeline_state = ?, updated_at = ? WHERE ticket_key = ?'
  );
  const setLastSeenStatusStmt = db.prepare(
    'UPDATE tickets SET last_seen_status = ?, jira_status = ?, updated_at = ? WHERE ticket_key = ?'
  );
  const setGithubFactsStmt = db.prepare(`
    UPDATE tickets SET branch_name = COALESCE(?, branch_name),
      pr_number = COALESCE(?, pr_number), pr_state = COALESCE(?, pr_state),
      check_status = COALESCE(?, check_status), head_sha = COALESCE(?, head_sha),
      updated_at = ?
    WHERE ticket_key = ?
  `);
  const setRepoStmt = db.prepare(
    'UPDATE tickets SET repo_owner = ?, repo_name = ?, updated_at = ? WHERE ticket_key = ?'
  );
  // Plain SET, not COALESCE — unlike setGithubFacts (used for "here's a
  // new/updated fact"), this is for "the PR this ticket pointed at is
  // gone, stop showing it as if it still exists" (e.g. a closed/deleted
  // PR discovered during a merge attempt). branch_name is left alone:
  // it's still useful context (the name to recreate), not stale/wrong.
  const clearGithubFactsStmt = db.prepare(`
    UPDATE tickets SET pr_number = NULL, pr_state = NULL, check_status = NULL, head_sha = NULL, updated_at = ?
    WHERE ticket_key = ?
  `);

  /**
   * Merges an incoming (partial) ticket description with any existing
   * row so that a Jira-only refresh (poller upsert, which knows nothing
   * about branch/PR/pipeline/repo state) never clobbers fields only a
   * handler or the repo resolver knows how to set.
   */
  function upsert(ticket) {
    const existing = getStmt.get(ticket.key);
    const now = new Date().toISOString();
    upsertStmt.run({
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
    });
  }

  return {
    upsert,
    get(ticketKey) {
      return getStmt.get(ticketKey);
    },
    list() {
      return listStmt.all();
    },
    listByPipelineState(state) {
      return listByStateStmt.all(state);
    },
    listByPipelineStateAndRepo(state, owner, name) {
      return listByStateAndRepoStmt.all(state, owner, name);
    },
    listByJiraStatus(jiraStatus) {
      return listByJiraStatusStmt.all(jiraStatus);
    },
    getLastSeenStatus(ticketKey) {
      const row = getStmt.get(ticketKey);
      return row ? row.last_seen_status : null;
    },
    setPipelineState(ticketKey, pipelineState) {
      setPipelineStateStmt.run(pipelineState, new Date().toISOString(), ticketKey);
    },
    setLastSeenStatus(ticketKey, status) {
      setLastSeenStatusStmt.run(status, status, new Date().toISOString(), ticketKey);
    },
    setGithubFacts(ticketKey, { branchName, prNumber, prState, checkStatus, headSha } = {}) {
      setGithubFactsStmt.run(
        branchName ?? null,
        prNumber ?? null,
        prState ?? null,
        checkStatus ?? null,
        headSha ?? null,
        new Date().toISOString(),
        ticketKey
      );
    },
    setRepo(ticketKey, owner, name) {
      setRepoStmt.run(owner, name, new Date().toISOString(), ticketKey);
    },
    clearGithubFacts(ticketKey) {
      clearGithubFactsStmt.run(new Date().toISOString(), ticketKey);
    },
  };
}

module.exports = { createTicketsRepo };
