const { createTestDb } = require('../setup');

async function freshRepo() {
  const { ticketsRepo } = await createTestDb();
  return ticketsRepo;
}

describe('ticketsRepo.clearGithubFacts', () => {
  it('clears pr_number/pr_state/check_status/head_sha but leaves branch_name alone', async () => {
    const repo = await freshRepo();
    await repo.upsert({ key: 'PROJ-1', summary: 'Task', jiraStatus: 'In QA' });
    await repo.setGithubFacts('PROJ-1', { branchName: 'feat/PROJ-1-thing', prNumber: 4, prState: 'open', checkStatus: 'pending', headSha: 'abc123' });

    await repo.clearGithubFacts('PROJ-1');

    const row = await repo.get('PROJ-1');
    expect(row.pr_number).toBeNull();
    expect(row.pr_state).toBeNull();
    expect(row.check_status).toBeNull();
    expect(row.head_sha).toBeNull();
    expect(row.branch_name).toBe('feat/PROJ-1-thing');
  });

  it('leaves pipeline_state and other fields untouched', async () => {
    const repo = await freshRepo();
    await repo.upsert({ key: 'PROJ-1', summary: 'Task', jiraStatus: 'In QA', pipelineState: 'conflict' });
    await repo.setGithubFacts('PROJ-1', { prNumber: 4 });

    await repo.clearGithubFacts('PROJ-1');

    expect((await repo.get('PROJ-1')).pipeline_state).toBe('conflict');
    expect((await repo.get('PROJ-1')).summary).toBe('Task');
  });
});

describe('ticketsRepo.clearFeatureWork', () => {
  it('clears branch and PR facts and sets pipeline_state to unmerged', async () => {
    const repo = await freshRepo();
    await repo.upsert({ key: 'PROJ-1', summary: 'Task', jiraStatus: 'In QA', pipelineState: 'staging_queued' });
    await repo.setGithubFacts('PROJ-1', {
      branchName: 'feat/PROJ-1-thing',
      prNumber: 4,
      prState: 'open',
      checkStatus: 'pending',
      headSha: 'abc123',
    });

    await repo.clearFeatureWork('PROJ-1');

    const row = await repo.get('PROJ-1');
    expect(row.branch_name).toBeNull();
    expect(row.pr_number).toBeNull();
    expect(row.pr_state).toBeNull();
    expect(row.check_status).toBeNull();
    expect(row.head_sha).toBeNull();
    expect(row.pipeline_state).toBe('unmerged');
  });
});

describe('ticketsRepo.setAssignee', () => {
  it('updates name and avatar, including clearing them', async () => {
    const repo = await freshRepo();
    await repo.upsert({ key: 'PROJ-1', summary: 'Task', jiraStatus: 'In QA', assigneeName: 'Ada' });
    await repo.setAssignee('PROJ-1', { name: 'Quinn', avatarUrl: 'https://x/q.png' });
    expect(await repo.get('PROJ-1')).toMatchObject({
      assignee_name: 'Quinn',
      assignee_avatar_url: 'https://x/q.png',
    });
    await repo.setAssignee('PROJ-1', { name: null, avatarUrl: null });
    expect((await repo.get('PROJ-1')).assignee_name).toBeNull();
    expect((await repo.get('PROJ-1')).assignee_avatar_url).toBeNull();
  });
});

describe('ticketsRepo.setCheckStatus', () => {
  it('can clear a stale pending value', async () => {
    const repo = await freshRepo();
    await repo.upsert({ key: 'PROJ-1', summary: 'Task', jiraStatus: 'Done' });
    await repo.setGithubFacts('PROJ-1', { checkStatus: 'pending' });
    await repo.setCheckStatus('PROJ-1', null);
    expect((await repo.get('PROJ-1')).check_status).toBeNull();
  });
});
