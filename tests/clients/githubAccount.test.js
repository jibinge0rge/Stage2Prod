const nock = require('nock');
const { getRepoInfo, listBranchesForRepo } = require('../../src/clients/githubAccount');

const GITHUB_API = 'https://api.github.com';

describe('githubAccount input validation', () => {
  beforeEach(() => nock.disableNetConnect());
  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
  });

  describe('getRepoInfo', () => {
    it('rejects an owner/name containing a slash before ever calling GitHub', async () => {
      // No nock interceptor registered — a real fetch attempt would throw
      // "Disallowed net connect" instead of the validation error below.
      await expect(getRepoInfo('tok', 'acme', 'widgets/../secrets')).rejects.toMatchObject({ status: 400 });
    });

    it('rejects an owner containing a space', async () => {
      await expect(getRepoInfo('tok', 'ac me', 'widgets')).rejects.toMatchObject({ status: 400 });
    });

    it('accepts a normal owner/name and calls the expected URL', async () => {
      nock(GITHUB_API).get('/repos/acme/widgets').reply(200, { default_branch: 'main' });
      const result = await getRepoInfo('tok', 'acme', 'widgets');
      expect(result).toEqual({ exists: true, defaultBranch: 'main' });
    });
  });

  describe('listBranchesForRepo', () => {
    it('rejects a name containing a slash before ever calling GitHub', async () => {
      await expect(listBranchesForRepo('tok', 'acme', 'widgets/evil')).rejects.toMatchObject({ status: 400 });
    });

    it('accepts a normal owner/name and calls the expected URL', async () => {
      nock(GITHUB_API).get('/repos/acme/widgets/branches').query(true).reply(200, [{ name: 'main' }]);
      const result = await listBranchesForRepo('tok', 'acme', 'widgets');
      expect(result).toEqual(['main']);
    });
  });
});
