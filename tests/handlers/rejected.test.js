const { rejected } = require('../../src/handlers/rejected');
const { createTestDb, seedTicket, noopLogger } = require('../setup');
const { OUTCOMES, PIPELINE_STATES } = require('../../src/lib/constants');

function baseDeps(overrides = {}) {
  const { ticketsRepo, eventsRepo } = createTestDb();
  seedTicket(ticketsRepo, { key: 'PROJ-1', jiraStatus: 'QA Failed' });

  const pr = { number: 55, head: { ref: 'feat/PROJ-1-thing' } };
  const github = { addLabel: vi.fn().mockResolvedValue({ added: true }) };
  const jira = { addComment: vi.fn().mockResolvedValue({ commented: true }) };
  const ticketMatcher = { findOpenPrForTicket: vi.fn().mockResolvedValue(pr) };

  return {
    event: { ticketKey: 'PROJ-1', newStatus: 'QA Failed' },
    log: noopLogger,
    correlationId: 'corr-1',
    repoOwner: 'acme',
    repoName: 'widgets',
    github,
    jira,
    ticketsRepo,
    eventsRepo,
    ticketMatcher,
    ...overrides,
  };
}

describe('rejected handler', () => {
  it('never calls any ref-mutating GitHub method', async () => {
    const deps = baseDeps();
    await rejected(deps);
    expect(deps.github.addLabel).toHaveBeenCalledWith(55, 'qa-rejected');
    expect(deps.github).not.toHaveProperty('createMerge');
    expect(deps.github).not.toHaveProperty('mergePr');
    expect(deps.github).not.toHaveProperty('deleteRef');
    expect(deps.github).not.toHaveProperty('updateRef');
  });

  it('comments on Jira, labels the PR, and records NOTED with pipeline state rejected', async () => {
    const deps = baseDeps();
    const result = await rejected(deps);

    expect(result.outcome).toBe(OUTCOMES.NOTED);
    expect(deps.jira.addComment).toHaveBeenCalledWith('PROJ-1', expect.stringContaining('rejected'));
    expect(deps.ticketsRepo.get('PROJ-1').pipeline_state).toBe(PIPELINE_STATES.REJECTED);

    const { events } = deps.eventsRepo.list({ ticketKey: 'PROJ-1' });
    expect(events[0].action).toBe('label');
    expect(events[0].repo).toEqual({ owner: 'acme', name: 'widgets' });
  });

  it('still comments and records the event when no matching PR is found', async () => {
    const deps = baseDeps();
    deps.ticketMatcher.findOpenPrForTicket = vi.fn().mockResolvedValue(null);

    const result = await rejected(deps);

    expect(result.outcome).toBe(OUTCOMES.NOTED);
    expect(deps.github.addLabel).not.toHaveBeenCalled();
    expect(deps.jira.addComment).toHaveBeenCalled();
  });
});
