const nock = require('nock');
const { GitHubClient } = require('../../src/clients/github');

const BASE = 'https://api.github.com';

describe('GitHubClient', () => {
  let client;

  beforeEach(() => {
    nock.disableNetConnect();
    client = new GitHubClient({ token: 't0k3n', owner: 'acme', repo: 'widgets' });
  });

  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
  });

  it('retries a 5xx write up to 3 times then succeeds', async () => {
    nock(BASE).put('/repos/acme/widgets/pulls/1/merge').reply(503);
    nock(BASE).put('/repos/acme/widgets/pulls/1/merge').reply(503);
    nock(BASE).put('/repos/acme/widgets/pulls/1/merge').reply(200, { merged: true, sha: 'abc' });

    const result = await client.mergePr(1, { mergeMethod: 'merge' });
    expect(result).toEqual({ merged: true, sha: 'abc' });
    expect(nock.isDone()).toBe(true);
  });

  it('gives up after exhausting retries on repeated 5xx', async () => {
    nock(BASE).put('/repos/acme/widgets/pulls/2/merge').times(4).reply(502);

    await expect(client.mergePr(2, { mergeMethod: 'merge' })).rejects.toMatchObject({ status: 502 });
  });

  it('never retries a 409 — createMerge reports conflict immediately', async () => {
    nock(BASE).post('/repos/acme/widgets/merges').reply(409, { message: 'Merge conflict' });

    const result = await client.createMerge({ base: 'staging', head: 'feat/x' });
    expect(result).toEqual({ conflict: true, sha: null });
  });

  it('parses rate-limit headers from responses', async () => {
    nock(BASE)
      .get('/repos/acme/widgets/branches?per_page=100&page=1')
      .reply(200, [], { 'x-ratelimit-remaining': '4321', 'x-ratelimit-limit': '5000', 'x-ratelimit-reset': '1999999999' });

    await client.listBranches();
    expect(client.rateLimit.remaining).toBe(4321);
    expect(client.rateLimit.limit).toBe(5000);
  });

  it('sends a bearer token and required GitHub headers', async () => {
    nock(BASE, { reqheaders: { authorization: 'Bearer t0k3n', 'x-github-api-version': '2022-11-28' } })
      .get('/repos/acme/widgets/git/ref/heads/develop')
      .reply(200, { object: { sha: 'sha123' } });

    const sha = await client.getRef('develop');
    expect(sha).toBe('sha123');
  });

  it('compareCommits returns ahead_by as aheadBy', async () => {
    nock(BASE).get('/repos/acme/widgets/compare/develop...staging').reply(200, { ahead_by: 7, behind_by: 0 });
    const result = await client.compareCommits('develop', 'staging');
    expect(result).toEqual({ aheadBy: 7, behindBy: 0 });
  });

  it('listCommitsAhead returns the compare endpoint\'s own commits array', async () => {
    nock(BASE)
      .get('/repos/acme/widgets/compare/develop...staging')
      .reply(200, { ahead_by: 1, behind_by: 0, commits: [{ sha: 'c1', commit: { message: 'x' } }] });
    const result = await client.listCommitsAhead('develop', 'staging');
    expect(result).toEqual([{ sha: 'c1', commit: { message: 'x' } }]);
  });

  it('listCommitsAhead returns [] when the compare response has no commits field', async () => {
    nock(BASE).get('/repos/acme/widgets/compare/develop...staging').reply(200, { ahead_by: 0, behind_by: 0 });
    const result = await client.listCommitsAhead('develop', 'staging');
    expect(result).toEqual([]);
  });
});
