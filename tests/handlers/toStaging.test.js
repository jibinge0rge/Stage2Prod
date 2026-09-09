const { toStaging } = require('../../src/handlers/toStaging');
const { createTestDb, seedTicket, noopLogger } = require('../setup');
const { OUTCOMES, PIPELINE_STATES } = require('../../src/lib/constants');

function baseDeps(overrides = {}) {
  const { ticketsRepo, eventsRepo, lockManager } = createTestDb();
  seedTicket(ticketsRepo, { key: 'PROJ-1', jiraStatus: 'In QA' });

  const github = {
    createMerge: vi.fn().mockResolvedValue({ conflict: false, sha: 'abc1234def' }),
  };
  const jira = {
    addComment: vi.fn().mockResolvedValue({ commented: true }),
    tryTransition: vi.fn().mockResolvedValue({ transitioned: false }),
  };
  const ticketMatcher = {
    findBranchForTicket: vi.fn().mockResolvedValue('feat/PROJ-1-thing'),
  };

  return {
    event: { ticketKey: 'PROJ-1', newStatus: 'In QA' },
    log: noopLogger,
    correlationId: 'corr-1',
    repoOwner: 'acme',
    repoName: 'widgets',
    // Deliberately not the default 'staging' — proves the name is
    // actually threaded through rather than hardcoded anywhere.
    stagingBranch: 'qa',
    github,
    jira,
    ticketsRepo,
    eventsRepo,
    lockManager,
    ticketMatcher,
    ...overrides,
  };
}

describe('toStaging handler', () => {
  it('merges the feature branch into the repo\'s configured staging branch and comments success on Jira', async () => {
    const deps = baseDeps();
    const result = await toStaging(deps);

    expect(result.outcome).toBe(OUTCOMES.MERGED);
    expect(deps.github.createMerge).toHaveBeenCalledWith({ base: 'qa', head: 'feat/PROJ-1-thing' });
    expect(deps.jira.addComment).toHaveBeenCalledWith('PROJ-1', expect.stringContaining('staging'));
    expect(deps.ticketsRepo.get('PROJ-1').pipeline_state).toBe(PIPELINE_STATES.STAGING);

    const { events } = deps.eventsRepo.list({ ticketKey: 'PROJ-1' });
    expect(events[0].outcome).toBe(OUTCOMES.MERGED);
    expect(events[0].repo).toEqual({ owner: 'acme', name: 'widgets' });
  });

  it('on 409 conflict, comments the conflict message, attempts a transition, and records CONFLICT', async () => {
    const deps = baseDeps();
    deps.github.createMerge = vi.fn().mockResolvedValue({ conflict: true, sha: null });

    const result = await toStaging(deps);

    expect(result.outcome).toBe(OUTCOMES.CONFLICT);
    expect(deps.jira.addComment).toHaveBeenCalledWith('PROJ-1', expect.stringContaining('conflicts'));
    expect(deps.jira.tryTransition).toHaveBeenCalledWith('PROJ-1', 'Needs Attention');
    expect(deps.ticketsRepo.get('PROJ-1').pipeline_state).toBe(PIPELINE_STATES.CONFLICT);

    const { events } = deps.eventsRepo.list({ ticketKey: 'PROJ-1' });
    expect(events[0].outcome).toBe(OUTCOMES.CONFLICT);
  });

  it('records NOTED and makes no GitHub/Jira calls when no branch matches the ticket', async () => {
    const deps = baseDeps();
    deps.ticketMatcher.findBranchForTicket = vi.fn().mockResolvedValue(null);

    const result = await toStaging(deps);

    expect(result.outcome).toBe(OUTCOMES.NOTED);
    expect(deps.github.createMerge).not.toHaveBeenCalled();
    expect(deps.jira.addComment).not.toHaveBeenCalled();
  });

  it('serializes two concurrent staging merges in the same repo via the ref lock', async () => {
    const deps = baseDeps();
    const order = [];
    deps.github.createMerge = vi.fn().mockImplementation(async () => {
      order.push('merge-start');
      await new Promise((r) => setTimeout(r, 20));
      order.push('merge-end');
      return { conflict: false, sha: 'sha1' };
    });

    const other = { ...deps, event: { ticketKey: 'PROJ-1', newStatus: 'In QA' } };
    await Promise.all([toStaging(deps), toStaging(other)]);

    expect(order).toEqual(['merge-start', 'merge-end', 'merge-start', 'merge-end']);
  });

  it('does NOT serialize concurrent staging merges across two different repos', async () => {
    const deps = baseDeps();
    const order = [];
    const slowMerge = async (label) => {
      order.push(`${label}-start`);
      await new Promise((r) => setTimeout(r, 20));
      order.push(`${label}-end`);
      return { conflict: false, sha: 'sha1' };
    };
    deps.github.createMerge = vi.fn(() => slowMerge('a'));

    const otherRepoDeps = {
      ...deps,
      repoOwner: 'other',
      repoName: 'repo',
      github: { createMerge: vi.fn(() => slowMerge('b')) },
    };

    await Promise.all([toStaging(deps), toStaging(otherRepoDeps)]);

    // Both start before either finishes — proves the lock keys differ per repo.
    expect(order).toEqual(['a-start', 'b-start', 'a-end', 'b-end']);
  });
});
