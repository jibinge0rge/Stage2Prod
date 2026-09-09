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
        .post('/rest/api/3/search/jql', { jql: 'project = PROJ', fields: ['summary', 'status', 'assignee', 'updated', 'sprint'], maxResults: 100 })
        .reply(200, { issues: [], isLast: true });

      const result = await client.search('project = PROJ');
      expect(result.issues).toEqual([]);
    });

    it('returns issues from a single page when isLast is true', async () => {
      nock(BASE)
        .post('/rest/api/3/search/jql')
        .reply(200, { issues: [{ key: 'PROJ-1' }, { key: 'PROJ-2' }], isLast: true });

      const result = await client.search('project = PROJ');
      expect(result.issues.map((i) => i.key)).toEqual(['PROJ-1', 'PROJ-2']);
    });

    it('follows nextPageToken across multiple pages and concatenates issues', async () => {
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

  it('reports transition-not-available when the named transition does not exist', async () => {
    nock(BASE).get('/rest/api/3/issue/PROJ-5/transitions').reply(200, { transitions: [] });
    const result = await client.transition('PROJ-5', 'Needs Attention');
    expect(result).toEqual({ transitioned: false, reason: 'transition-not-available' });
  });
});
