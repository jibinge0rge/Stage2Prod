const nock = require('nock');
const { JiraClient } = require('../../src/clients/jira');

const HOST = 'example.atlassian.net';
const BASE = `https://${HOST}`;

describe('JiraClient', () => {
  let client;

  beforeEach(() => {
    nock.disableNetConnect();
    client = new JiraClient({ host: HOST, email: 'bot@example.com', apiToken: 'tok' });
  });

  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
  });

  describe('search', () => {
    it('constructs the Basic auth header and posts to /rest/api/3/search/jql (the replacement for the removed GET /search)', async () => {
      const expected = `Basic ${Buffer.from('bot@example.com:tok').toString('base64')}`;
      nock(BASE, { reqheaders: { authorization: expected } })
        .get('/rest/api/3/field')
        .reply(200, [
          { id: 'customfield_10020', name: 'Sprint', schema: { custom: 'com.pyxis.greenhopper.jira:gh-sprint' } },
        ]);
      nock(BASE, { reqheaders: { authorization: expected } })
        .post('/rest/api/3/search/jql', {
          jql: 'project = PROJ',
          fields: ['summary', 'status', 'assignee', 'updated', 'closedSprints', 'customfield_10020'],
          maxResults: 100,
        })
        .reply(200, { issues: [], isLast: true });

      const result = await client.search('project = PROJ');
      expect(result.issues).toEqual([]);
    });

    it('returns issues from a single page when isLast is true', async () => {
      nock(BASE).get('/rest/api/3/field').reply(200, []);
      nock(BASE)
        .post('/rest/api/3/search/jql')
        .reply(200, { issues: [{ key: 'PROJ-1' }, { key: 'PROJ-2' }], isLast: true });

      const result = await client.search('project = PROJ');
      expect(result.issues.map((i) => i.key)).toEqual(['PROJ-1', 'PROJ-2']);
    });

    it('follows nextPageToken across multiple pages and concatenates issues', async () => {
      nock(BASE).get('/rest/api/3/field').reply(200, []);
      nock(BASE)
        .post('/rest/api/3/search/jql', (body) => !body.nextPageToken)
        .reply(200, { issues: [{ key: 'PROJ-1' }], isLast: false, nextPageToken: 'page-2' });
      nock(BASE)
        .post('/rest/api/3/search/jql', (body) => body.nextPageToken === 'page-2')
        .reply(200, { issues: [{ key: 'PROJ-2' }], isLast: true });

      const result = await client.search('project = PROJ');
      expect(result.issues.map((i) => i.key)).toEqual(['PROJ-1', 'PROJ-2']);
      expect(nock.isDone()).toBe(true);
    });

    it('stops when a response omits nextPageToken even without an explicit isLast:true', async () => {
      nock(BASE).get('/rest/api/3/field').reply(200, []);
      nock(BASE).post('/rest/api/3/search/jql').reply(200, { issues: [{ key: 'PROJ-1' }] });

      const result = await client.search('project = PROJ');
      expect(result.issues).toHaveLength(1);
    });
  });

  it('retries a 429 and honors Retry-After', async () => {
    nock(BASE)
      .post('/rest/api/3/issue/PROJ-1/comment')
      .reply(429, {}, { 'retry-after': '0' });
    nock(BASE).post('/rest/api/3/issue/PROJ-1/comment').reply(204);

    const result = await client.addComment('PROJ-1', 'hello');
    expect(result).toEqual({ commented: true });
  });

  it('gives up after exhausting 429 retries', async () => {
    nock(BASE).post('/rest/api/3/issue/PROJ-2/comment').times(6).reply(429, {}, { 'retry-after': '0' });

    await expect(client.addComment('PROJ-2', 'hello')).rejects.toMatchObject({ status: 429 });
  });

  it('tryTransition swallows errors and reports them without throwing', async () => {
    nock(BASE).get('/rest/api/3/issue/PROJ-3/transitions').reply(500, { errorMessages: ['boom'] });

    const result = await client.tryTransition('PROJ-3', 'Needs Attention');
    expect(result.transitioned).toBe(false);
    expect(result.reason).toBe('error');
  });

  it('transition finds the matching transition by name and posts its id', async () => {
    nock(BASE)
      .get('/rest/api/3/issue/PROJ-4/transitions')
      .reply(200, { transitions: [{ id: '31', name: 'Needs Attention' }, { id: '11', name: 'Done' }] });
    nock(BASE)
      .post('/rest/api/3/issue/PROJ-4/transitions', { transition: { id: '31' } })
      .reply(204);

    const result = await client.transition('PROJ-4', 'Needs Attention');
    expect(result).toEqual({ transitioned: true });
  });

  it('transition matches a destination status name when the workflow transition is named differently', async () => {
    nock(BASE)
      .get('/rest/api/3/issue/PROJ-6/transitions')
      .reply(200, {
        transitions: [{ id: '21', name: 'Start Progress', to: { name: 'In Progress' } }],
      });
    nock(BASE)
      .post('/rest/api/3/issue/PROJ-6/transitions', { transition: { id: '21' } })
      .reply(204);

    const result = await client.transition('PROJ-6', 'In Progress');
    expect(result).toEqual({ transitioned: true });
  });

  it('reports transition-not-available when the named transition does not exist', async () => {
    nock(BASE).get('/rest/api/3/issue/PROJ-5/transitions').reply(200, { transitions: [] });
    const result = await client.transition('PROJ-5', 'Needs Attention');
    expect(result).toEqual({ transitioned: false, reason: 'transition-not-available' });
  });

  describe('searchUsers', () => {
    it('uses assignable search when a project key is provided', async () => {
      nock(BASE)
        .get('/rest/api/3/user/assignable/search')
        .query({ query: 'ada', maxResults: '20', project: 'VIM' })
        .reply(200, [
          {
            accountId: 'a1',
            displayName: 'Ada',
            active: true,
            accountType: 'atlassian',
            avatarUrls: { '48x48': 'https://x/a.png' },
          },
          { accountId: 'bot', displayName: 'Bot', active: true, accountType: 'app' },
        ]);

      const users = await client.searchUsers({ query: 'ada', projectKey: 'VIM' });
      expect(users).toEqual([
        { accountId: 'a1', displayName: 'Ada', avatarUrl: 'https://x/a.png', emailAddress: null },
      ]);
    });

    it('falls back to global user search without a project', async () => {
      nock(BASE)
        .get('/rest/api/3/user/search')
        .query({ query: 'bob', maxResults: '20' })
        .reply(200, [{ accountId: 'b1', displayName: 'Bob', active: true, accountType: 'atlassian' }]);

      const users = await client.searchUsers({ query: 'bob' });
      expect(users).toEqual([
        { accountId: 'b1', displayName: 'Bob', avatarUrl: null, emailAddress: null },
      ]);
    });
  });
});
