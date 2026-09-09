const { createRepoResolver } = require('../../src/services/repoResolver');
const { createDb } = require('../../src/db');
const { createReposRepo } = require('../../src/db/repositories/reposRepo');

function branchGithub(branches) {
  return {
    listBranches: vi.fn().mockResolvedValue(branches.map((name) => ({ name, commit: { sha: 'x' } }))),
    listOpenPulls: vi.fn().mockResolvedValue([]),
  };
}

function buildResolver(reposByKey) {
  const db = createDb(':memory:');
  const reposRepo = createReposRepo(db);
  const githubRegistry = {
    getClient: vi.fn((owner, name) => reposByKey[`${owner}/${name}`] || branchGithub([])),
  };
  const resolver = createRepoResolver({ reposRepo, githubRegistry });
  return { resolver, reposRepo };
}

describe('repoResolver', () => {
  it('resolves to the one repo whose branch matches the ticket key', async () => {
    const { resolver, reposRepo } = buildResolver({
      'acme/widgets': branchGithub(['feat/PROJ-1-thing']),
      'acme/other': branchGithub(['main']),
    });
    reposRepo.add('acme', 'widgets');
    reposRepo.add('acme', 'other');

    const result = await resolver.resolveTicket('PROJ-1', null);
    expect(result).toEqual({ found: true, owner: 'acme', name: 'widgets' });
  });

  it('returns found:false when no watched repo has a matching branch or PR', async () => {
    const { resolver, reposRepo } = buildResolver({ 'acme/widgets': branchGithub(['main']) });
    reposRepo.add('acme', 'widgets');

    const result = await resolver.resolveTicket('PROJ-999', null);
    expect(result).toEqual({ found: false });
  });

  it('returns ambiguous:true when 2+ watched repos match', async () => {
    const { resolver, reposRepo } = buildResolver({
      'acme/widgets': branchGithub(['feat/PROJ-1-thing']),
      'acme/other': branchGithub(['feat/PROJ-1-duplicate']),
    });
    reposRepo.add('acme', 'widgets');
    reposRepo.add('acme', 'other');

    const result = await resolver.resolveTicket('PROJ-1', null);
    expect(result.found).toBe(false);
    expect(result.ambiguous).toBe(true);
    expect(result.candidates).toHaveLength(2);
  });

  it('reuses a known repo without re-searching other repos', async () => {
    const widgetsClient = branchGithub(['feat/PROJ-1-thing']);
    const { resolver, reposRepo } = buildResolver({ 'acme/widgets': widgetsClient });
    reposRepo.add('acme', 'widgets');

    const result = await resolver.resolveTicket('PROJ-1', { owner: 'acme', name: 'widgets' });

    expect(result).toEqual({ found: true, owner: 'acme', name: 'widgets' });
    expect(widgetsClient.listBranches).not.toHaveBeenCalled();
  });

  it('ignores a known repo that has since been unwatched, and re-searches', async () => {
    const { resolver, reposRepo } = buildResolver({
      'acme/widgets': branchGithub(['other-branch']),
      'acme/new-home': branchGithub(['feat/PROJ-1-thing']),
    });
    reposRepo.add('acme', 'widgets');
    reposRepo.add('acme', 'new-home');
    reposRepo.remove('acme', 'widgets'); // ticket's stored repo is no longer watched

    const result = await resolver.resolveTicket('PROJ-1', { owner: 'acme', name: 'widgets' });
    expect(result).toEqual({ found: true, owner: 'acme', name: 'new-home' });
  });

  it('invalidateAll() clears every per-repo matcher cache', async () => {
    const client = branchGithub(['feat/PROJ-1-thing']);
    const { resolver, reposRepo } = buildResolver({ 'acme/widgets': client });
    reposRepo.add('acme', 'widgets');

    await resolver.resolveTicket('PROJ-1', null);
    expect(client.listBranches).toHaveBeenCalledTimes(1);

    await resolver.resolveTicket('PROJ-1', null);
    expect(client.listBranches).toHaveBeenCalledTimes(1); // matcher's own TTL cache, no new call

    resolver.invalidateAll();
    await resolver.resolveTicket('PROJ-1', null);
    expect(client.listBranches).toHaveBeenCalledTimes(2);
  });
});
