const { createDb } = require('../../src/db');
const { createTicketsRepo } = require('../../src/db/repositories/ticketsRepo');

function freshRepo() {
  const db = createDb(':memory:');
  return createTicketsRepo(db);
}

describe('ticketsRepo.clearGithubFacts', () => {
  it('clears pr_number/pr_state/check_status/head_sha but leaves branch_name alone', () => {
    const repo = freshRepo();
    repo.upsert({ key: 'PROJ-1', summary: 'Task', jiraStatus: 'In QA' });
    repo.setGithubFacts('PROJ-1', { branchName: 'feat/PROJ-1-thing', prNumber: 4, prState: 'open', checkStatus: 'pending', headSha: 'abc123' });

    repo.clearGithubFacts('PROJ-1');

    const row = repo.get('PROJ-1');
    expect(row.pr_number).toBeNull();
    expect(row.pr_state).toBeNull();
    expect(row.check_status).toBeNull();
    expect(row.head_sha).toBeNull();
    expect(row.branch_name).toBe('feat/PROJ-1-thing');
  });

  it('leaves pipeline_state and other fields untouched', () => {
    const repo = freshRepo();
    repo.upsert({ key: 'PROJ-1', summary: 'Task', jiraStatus: 'In QA', pipelineState: 'conflict' });
    repo.setGithubFacts('PROJ-1', { prNumber: 4 });

    repo.clearGithubFacts('PROJ-1');

    expect(repo.get('PROJ-1').pipeline_state).toBe('conflict');
    expect(repo.get('PROJ-1').summary).toBe('Task');
  });
});
