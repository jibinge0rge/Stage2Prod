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

  it('createPr posts base/head/title/body and returns number, htmlUrl, headSha', async () => {
    nock(BASE)
      .post('/repos/acme/widgets/pulls', { base: 'staging', head: 'feat/x', title: 't', body: 'b' })
      .reply(201, { number: 5, html_url: 'https://github.com/acme/widgets/pull/5', head: { sha: 'headsha1' } });

    const result = await client.createPr({ base: 'staging', head: 'feat/x', title: 't', body: 'b' });
    expect(result).toEqual({ number: 5, htmlUrl: 'https://github.com/acme/widgets/pull/5', headSha: 'headsha1' });
  });

  it('closePr patches the pull to state closed', async () => {
    nock(BASE)
      .patch('/repos/acme/widgets/pulls/5', { state: 'closed' })
      .reply(200, { number: 5, state: 'closed' });

    const result = await client.closePr(5);
    expect(result).toEqual({ number: 5, state: 'closed' });
  });

  it('getMe returns the authenticated user login', async () => {
    nock(BASE).get('/user').reply(200, { login: 'qa-bot' });
    const result = await client.getMe();
    expect(result).toEqual({ login: 'qa-bot' });
  });

  it('createReview posts an approval on the pull', async () => {
    nock(BASE)
      .post('/repos/acme/widgets/pulls/5/reviews', { event: 'APPROVE', body: 'ok' })
      .reply(200, { id: 99, state: 'APPROVED' });

    const result = await client.createReview(5, { event: 'APPROVE', body: 'ok' });
    expect(result).toEqual({ id: 99, state: 'APPROVED' });
  });

  it('getPr returns state/mergeable/mergeableState/merged/base/head', async () => {
    nock(BASE)
      .get('/repos/acme/widgets/pulls/5')
      .reply(200, {
        number: 5,
        state: 'open',
        mergeable: false,
        mergeable_state: 'dirty',
        merged: false,
        base: { ref: 'staging' },
        head: { ref: 'feat/x' },
        html_url: 'https://x/5',
        user: { login: 'octocat' },
      });

    const result = await client.getPr(5);
    expect(result).toEqual({
      number: 5,
      state: 'open',
      mergeable: false,
      mergeableState: 'dirty',
      merged: false,
      base: 'staging',
      head: 'feat/x',
      htmlUrl: 'https://x/5',
      author: 'octocat',
    });
  });

  it('getCombinedStatus is null when the commit has no statuses or check runs', async () => {
    nock(BASE).get('/repos/acme/widgets/commits/abc/status').reply(200, { state: 'pending', statuses: [] });
    nock(BASE).get('/repos/acme/widgets/commits/abc/check-runs').reply(200, { check_runs: [] });

    const result = await client.getCombinedStatus('abc');
    expect(result.overall).toBeNull();
  });

  it('createRef posts refs/heads/{branch} at the given sha', async () => {
    nock(BASE)
      .post('/repos/acme/widgets/git/refs', { ref: 'refs/heads/feat/PROJ-1', sha: 'abc123' })
      .reply(201, { object: { sha: 'abc123' } });

    const result = await client.createRef('feat/PROJ-1', 'abc123');
    expect(result).toEqual({ sha: 'abc123' });
  });
});
