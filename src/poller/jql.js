/**
 * Builds the JQL the poller actually searches with: the union of every
 * active repo's configured Jira project, so a multi-repo setup doesn't
 * need one hand-maintained env var trying to cover every project. Falls
 * back to config.JIRA_JQL verbatim until at least one repo has a project
 * key configured, so a fresh install (no repos configured yet) keeps
 * working exactly as before.
 */
function buildPollJql(activeRepos, config) {
  const projectKeys = [...new Set(activeRepos.map((r) => r.jiraProjectKey).filter(Boolean))];
  if (projectKeys.length === 0) return config.JIRA_JQL;
  const projectList = projectKeys.map((k) => `"${k}"`).join(', ');
  return `project in (${projectList}) AND ${config.JIRA_POLL_CLAUSE} ORDER BY updated ASC`;
}

module.exports = { buildPollJql };
