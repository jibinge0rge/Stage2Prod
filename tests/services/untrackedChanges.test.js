const { untrackedForRepo } = require('../../src/services/untrackedChanges');

function repo(overrides = {}) {
  return { owner: 'acme', name: 'widgets', productionBranch: 'develop', stagingBranch: 'staging', ...overrides };
}

function stubGithub(overrides = {}) {
  return {
    listOpenPulls: vi.fn().mockResolvedValue([]),
    listCommitsAhead: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

describe('untrackedForRepo', () => {
  it('splits open PRs without a tracked ticket by base branch (staging vs production)', async () => {
    const github = stubGithub({
      listOpenPulls: vi.fn().mockResolvedValue([
        { number: 1, title: 'PROJ-1 thing', head: { ref: 'feat/PROJ-1-thing' }, base: { ref: 'staging' }, user: { login: 'alice' }, html_url: 'https://x/1', created_at: 't1' },
        { number: 2, title: 'unplanned tweak', head: { ref: 'quick-hotfix' }, base: { ref: 'staging' }, user: { login: 'bob' }, html_url: 'https://x/2', created_at: 't2' },
        { number: 3, title: 'straight to prod', head: { ref: 'hotfix-prod' }, base: { ref: 'develop' }, user: { login: 'carol' }, html_url: 'https://x/3', created_at: 't3' },
      ]),
    });

    const result = await untrackedForRepo({ repo: repo(), github, ticketKeys: ['PROJ-1'] });

    expect(result.pullRequestsToStaging).toHaveLength(1);
    expect(result.pullRequestsToStaging[0]).toMatchObject({ number: 2, headRef: 'quick-hotfix', baseRef: 'staging' });
    expect(result.pullRequestsToProduction).toHaveLength(1);
    expect(result.pullRequestsToProduction[0]).toMatchObject({ number: 3, headRef: 'hotfix-prod', baseRef: 'develop' });
  });

  it('ignores an open PR whose base is neither the staging nor the production branch', async () => {
    const github = stubGithub({
      listOpenPulls: vi.fn().mockResolvedValue([
        { number: 4, title: 'branch to branch', head: { ref: 'feature-b' }, base: { ref: 'feature-a' }, user: { login: 'dave' }, html_url: 'https://x/4', created_at: 't4' },
      ]),
    });

    const result = await untrackedForRepo({ repo: repo(), github, ticketKeys: [] });
    expect(result.pullRequestsToStaging).toEqual([]);
    expect(result.pullRequestsToProduction).toEqual([]);
  });

  it('reports staging commits ahead of production with no tracked ticket, excluding ones that do reference one', async () => {
    const github = stubGithub({
      listCommitsAhead: vi.fn().mockResolvedValue([
        { sha: 's1', commit: { message: 'PROJ-1 merge', author: { name: 'alice', date: 't1' } }, html_url: 'https://x/c1' },
        { sha: 's2', commit: { message: 'someone merged this straight to staging', author: { name: 'bob', date: 't2' } }, html_url: 'https://x/c2' },
      ]),
    });

    const result = await untrackedForRepo({ repo: repo(), github, ticketKeys: ['PROJ-1'] });

    expect(result.stagingCommits).toEqual([
      { sha: 's2', message: 'someone merged this straight to staging', author: 'bob', date: 't2', url: 'https://x/c2' },
    ]);
    expect(github.listCommitsAhead).toHaveBeenCalledWith('develop', 'staging');
  });

  it('tolerates listCommitsAhead failing by reporting no untracked staging commits', async () => {
    const github = stubGithub({ listCommitsAhead: vi.fn().mockRejectedValue(new Error('boom')) });

    const result = await untrackedForRepo({ repo: repo(), github, ticketKeys: [] });
    expect(result.stagingCommits).toEqual([]);
  });

  it('tolerates listOpenPulls failing (e.g. revoked access) without throwing', async () => {
    const github = stubGithub({ listOpenPulls: vi.fn().mockRejectedValue(new Error('Bad credentials')) });

    const result = await untrackedForRepo({ repo: repo(), github, ticketKeys: [] });
    expect(result.pullRequestsToStaging).toEqual([]);
    expect(result.pullRequestsToProduction).toEqual([]);
  });
});
