const { buildPollJql } = require('../../src/poller/jql');

const config = { JIRA_JQL: 'project = PROJ AND (statusCategory != Done OR updated >= -15m) ORDER BY updated ASC', JIRA_POLL_CLAUSE: '(statusCategory != Done OR updated >= -15m)' };

function repo(jiraProjectKey) {
  return { owner: 'acme', name: 'widgets', jiraProjectKey };
}

describe('buildPollJql', () => {
  it('falls back to config.JIRA_JQL when no active repo has a Jira project key', () => {
    expect(buildPollJql([repo(null), repo(undefined)], config)).toBe(config.JIRA_JQL);
  });

  it('falls back to config.JIRA_JQL when there are no active repos at all', () => {
    expect(buildPollJql([], config)).toBe(config.JIRA_JQL);
  });

  it('builds a project-scoped query from a single configured repo', () => {
    expect(buildPollJql([repo('PROJ')], config)).toBe('project in ("PROJ") AND (statusCategory != Done OR updated >= -15m) ORDER BY updated ASC');
  });

  it('unions multiple distinct project keys across repos', () => {
    const result = buildPollJql([repo('PROJ'), repo('OTHER')], config);
    expect(result).toBe('project in ("PROJ", "OTHER") AND (statusCategory != Done OR updated >= -15m) ORDER BY updated ASC');
  });

  it('de-duplicates repos that share the same project key', () => {
    const result = buildPollJql([repo('PROJ'), repo('PROJ')], config);
    expect(result).toBe('project in ("PROJ") AND (statusCategory != Done OR updated >= -15m) ORDER BY updated ASC');
  });

  it('ignores repos without a project key while still using the ones that have it', () => {
    const result = buildPollJql([repo('PROJ'), repo(null)], config);
    expect(result).toBe('project in ("PROJ") AND (statusCategory != Done OR updated >= -15m) ORDER BY updated ASC');
  });
});
