const { toStaging } = require('../../src/handlers/toStaging');
const { createTestDb, seedTicket, noopLogger } = require('../setup');
const { OUTCOMES, PIPELINE_STATES } = require('../../src/lib/constants');

function baseDeps(overrides = {}) {
  const { ticketsRepo, eventsRepo, lockManager } = createTestDb();
  seedTicket(ticketsRepo, { key: 'PROJ-1', jiraStatus: 'In QA' });

  const github = {
    createPr: vi.fn().mockResolvedValue({ number: 42, htmlUrl: 'https://x/42', headSha: 'headsha1' }),
  };
  const jira = {
    addComment: vi.fn().mockResolvedValue({ commented: true }),
  };
  const ticketMatcher = {
    findBranchForTicket: vi.fn().mockResolvedValue('feat/PROJ-1-thing'),
    findOpenPrForTicket: vi.fn().mockResolvedValue(null),
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
  it('opens a PR from the feature branch into the configured staging branch, but does not merge it', async () => {
    const deps = baseDeps();
    const result = await toStaging(deps);

    expect(result.outcome).toBe(OUTCOMES.PR_OPENED);
    expect(deps.ticketMatcher.findOpenPrForTicket).toHaveBeenCalledWith('PROJ-1', { base: 'qa' });
    expect(deps.github.createPr).toHaveBeenCalledWith({
      base: 'qa',
      head: 'feat/PROJ-1-thing',
      title: expect.any(String),
      body: expect.any(String),
    });
    expect(deps.jira.addComment).toHaveBeenCalledWith('PROJ-1', expect.stringContaining('qa'));
    const row = deps.ticketsRepo.get('PROJ-1');
    expect(row.pipeline_state).toBe(PIPELINE_STATES.STAGING_QUEUED);
    expect(row.pr_number).toBe(42);

    const { events } = deps.eventsRepo.list({ ticketKey: 'PROJ-1' });
    expect(events[0].outcome).toBe(OUTCOMES.PR_OPENED);
    expect(events[0].repo).toEqual({ owner: 'acme', name: 'widgets' });
  });

  it('reuses an already-open PR instead of creating a duplicate', async () => {
    const deps = baseDeps();
    deps.ticketMatcher.findOpenPrForTicket = vi.fn().mockResolvedValue({ number: 7, head: { ref: 'feat/PROJ-1-thing' } });

    const result = await toStaging(deps);

    expect(result.outcome).toBe(OUTCOMES.PR_OPENED);
    expect(deps.github.createPr).not.toHaveBeenCalled();
    expect(deps.ticketsRepo.get('PROJ-1').pr_number).toBe(7);
  });

  it('records NOTED and makes no GitHub/Jira calls when no branch matches the ticket', async () => {
    const deps = baseDeps();
    deps.ticketMatcher.findBranchForTicket = vi.fn().mockResolvedValue(null);

    const result = await toStaging(deps);

    expect(result.outcome).toBe(OUTCOMES.NOTED);
    expect(deps.github.createPr).not.toHaveBeenCalled();
    expect(deps.jira.addComment).not.toHaveBeenCalled();
  });

  it('serializes two concurrent staging PR-opens in the same repo via the ref lock', async () => {
    const deps = baseDeps();
    const order = [];
    deps.github.createPr = vi.fn().mockImplementation(async () => {
      order.push('open-start');
      await new Promise((r) => setTimeout(r, 20));
      order.push('open-end');
      return { number: 1, htmlUrl: 'https://x/1', headSha: 'sha1' };
    });

    const other = { ...deps, event: { ticketKey: 'PROJ-1', newStatus: 'In QA' } };
    await Promise.all([toStaging(deps), toStaging(other)]);

    expect(order).toEqual(['open-start', 'open-end', 'open-start', 'open-end']);
  });

  it('does NOT serialize concurrent staging PR-opens across two different repos', async () => {
    const deps = baseDeps();
    const order = [];
    const slowOpen = async (label) => {
      order.push(`${label}-start`);
      await new Promise((r) => setTimeout(r, 20));
      order.push(`${label}-end`);
      return { number: 1, htmlUrl: 'https://x/1', headSha: 'sha1' };
    };
    deps.github.createPr = vi.fn(() => slowOpen('a'));

    const otherRepoDeps = {
      ...deps,
      repoOwner: 'other',
      repoName: 'repo',
      github: { createPr: vi.fn(() => slowOpen('b')) },
      ticketMatcher: {
        findBranchForTicket: vi.fn().mockResolvedValue('feat/PROJ-1-thing'),
        findOpenPrForTicket: vi.fn().mockResolvedValue(null),
      },
    };

    await Promise.all([toStaging(deps), toStaging(otherRepoDeps)]);

    // Both start before either finishes — proves the lock keys differ per repo.
    expect(order).toEqual(['a-start', 'b-start', 'a-end', 'b-end']);
  });
});
