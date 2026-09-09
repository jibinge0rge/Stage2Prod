const express = require('express');

function rowToApi(row, reposRepo) {
  let repo = null;
  if (row.repo_owner) {
    const repoConfig = reposRepo.get(row.repo_owner, row.repo_name);
    repo = {
      owner: row.repo_owner,
      name: row.repo_name,
      productionBranch: repoConfig?.productionBranch ?? 'develop',
      stagingBranch: repoConfig?.stagingBranch ?? 'staging',
    };
  }
  return {
    key: row.ticket_key,
    summary: row.summary,
    branch: row.branch_name,
    jiraStatus: row.jira_status,
    pipelineState: row.pipeline_state,
    prNumber: row.pr_number,
    prState: row.pr_state,
    checkStatus: row.check_status,
    headSha: row.head_sha,
    assignee: row.assignee_name ? { name: row.assignee_name, avatarUrl: row.assignee_avatar_url } : null,
    sprint: row.sprint_name,
    updatedAt: row.updated_at,
    jiraUpdatedAt: row.jira_updated_at,
    repo,
  };
}

function createTicketsRouter({ ticketsRepo, eventsRepo, reposRepo }) {
  const router = express.Router();

  router.get('/tickets', (req, res) => {
    const { state, q, repo } = req.query;
    let rows = ticketsRepo.list();
    if (state && state !== 'all') rows = rows.filter((r) => r.pipeline_state === state);
    if (repo) {
      const [repoOwner, repoName] = String(repo).split('/');
      rows = rows.filter((r) => r.repo_owner === repoOwner && r.repo_name === repoName);
    }
    if (q) {
      const needle = String(q).toLowerCase();
      rows = rows.filter(
        (r) =>
          r.ticket_key.toLowerCase().includes(needle) ||
          (r.branch_name || '').toLowerCase().includes(needle) ||
          (r.summary || '').toLowerCase().includes(needle) ||
          (r.repo_owner ? `${r.repo_owner}/${r.repo_name}`.toLowerCase().includes(needle) : false)
      );
    }
    res.json({ tickets: rows.map((r) => rowToApi(r, reposRepo)), total: rows.length });
  });

  router.get('/tickets/:key', (req, res) => {
    const row = ticketsRepo.get(req.params.key);
    if (!row) return res.status(404).json({ error: 'not_found', message: `no ticket ${req.params.key}` });
    return res.json({ ...rowToApi(row, reposRepo), timeline: eventsRepo.timelineForTicket(req.params.key) });
  });

  return router;
}

module.exports = { createTicketsRouter, rowToApi };
