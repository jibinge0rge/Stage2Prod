const { assignTicket, assignTicketToRole } = require('../../src/lib/assignTicket');
const { createTestDb, seedTicket, noopLogger } = require('../setup');
const { OUTCOMES } = require('../../src/lib/constants');

describe('assignTicket', () => {
  it('writes the Jira assignee and mirrors name/avatar onto the ticket row', async () => {
    const { ticketsRepo, eventsRepo } = await createTestDb();
    await seedTicket(ticketsRepo, { key: 'PROJ-1', jiraStatus: 'In QA' });
    const jira = { tryAssign: vi.fn().mockResolvedValue({ assigned: true }) };

    const result = await assignTicket({
      jira,
      ticketsRepo,
      eventsRepo,
      ticketKey: 'PROJ-1',
      person: { accountId: 'q1', displayName: 'Quinn', avatarUrl: 'https://x/q.png' },
      log: noopLogger,
      trigger: 'test',
      repoOwner: 'acme',
      repoName: 'widgets',
      reason: 'Auto-assigned QA for this repo',
    });

    expect(result.assigned).toBe(true);
    expect(jira.tryAssign).toHaveBeenCalledWith('PROJ-1', 'q1');
    expect(await ticketsRepo.get('PROJ-1')).toMatchObject({
      assignee_name: 'Quinn',
      assignee_avatar_url: 'https://x/q.png',
    });
    const { events } = await eventsRepo.list({ ticketKey: 'PROJ-1' });
    expect(events[0]).toMatchObject({
      outcome: OUTCOMES.NOTED,
      title: 'Assigned to Quinn',
      detail: 'Auto-assigned QA for this repo',
    });
  });

  it('swallows thrown errors so a git write is never failed by Jira', async () => {
    const { ticketsRepo } = await createTestDb();
    await seedTicket(ticketsRepo, { key: 'PROJ-1' });
    const jira = { assign: vi.fn().mockRejectedValue(new Error('jira down')) };

    await expect(
      assignTicket({
        jira,
        ticketsRepo,
        ticketKey: 'PROJ-1',
        person: { accountId: 'q1', displayName: 'Quinn' },
        log: noopLogger,
      })
    ).resolves.toMatchObject({ assigned: false, reason: 'error' });
    expect((await ticketsRepo.get('PROJ-1')).assignee_name).toBeNull();
  });
});

describe('assignTicketToRole', () => {
  const qa = { accountId: 'q1', displayName: 'Quinn', avatarUrl: null };
  const qa2 = { accountId: 'q2', displayName: 'Sam', avatarUrl: null };

  it('assigns the sole person in a role without an explicit default', async () => {
    const { ticketsRepo } = await createTestDb();
    await seedTicket(ticketsRepo, { key: 'PROJ-1' });
    const jira = { tryAssign: vi.fn().mockResolvedValue({ assigned: true }) };

    const result = await assignTicketToRole({
      jira,
      ticketsRepo,
      ticketKey: 'PROJ-1',
      teamRoles: { qa: [qa], de: [], da: [], defaults: { de: null, qa: 'q1', da: null } },
      role: 'qa',
      log: noopLogger,
    });

    expect(result.assigned).toBe(true);
    expect(jira.tryAssign).toHaveBeenCalledWith('PROJ-1', 'q1');
  });

  it('assigns the configured default when a role has several people', async () => {
    const { ticketsRepo } = await createTestDb();
    await seedTicket(ticketsRepo, { key: 'PROJ-1' });
    const jira = { tryAssign: vi.fn().mockResolvedValue({ assigned: true }) };

    await assignTicketToRole({
      jira,
      ticketsRepo,
      ticketKey: 'PROJ-1',
      teamRoles: { qa: [qa, qa2], de: [], da: [], defaults: { de: null, qa: 'q2', da: null } },
      role: 'qa',
      log: noopLogger,
    });

    expect(jira.tryAssign).toHaveBeenCalledWith('PROJ-1', 'q2');
  });

  it('skips and records a note when several people are configured with no default', async () => {
    const { ticketsRepo, eventsRepo } = await createTestDb();
    await seedTicket(ticketsRepo, { key: 'PROJ-1' });
    const jira = { tryAssign: vi.fn() };

    const result = await assignTicketToRole({
      jira,
      ticketsRepo,
      eventsRepo,
      ticketKey: 'PROJ-1',
      teamRoles: { qa: [qa, qa2], de: [], da: [], defaults: { de: null, qa: null, da: null } },
      role: 'qa',
      log: noopLogger,
    });

    expect(result).toEqual({ assigned: false, reason: 'no-default' });
    expect(jira.tryAssign).not.toHaveBeenCalled();
    const { events } = await eventsRepo.list({ ticketKey: 'PROJ-1' });
    expect(events[0].title).toMatch(/Skipped QA assignment/);
  });

  it('skips silently when the role has no people', async () => {
    const { ticketsRepo, eventsRepo } = await createTestDb();
    await seedTicket(ticketsRepo, { key: 'PROJ-1' });
    const jira = { tryAssign: vi.fn() };

    const result = await assignTicketToRole({
      jira,
      ticketsRepo,
      eventsRepo,
      ticketKey: 'PROJ-1',
      teamRoles: { qa: [], de: [], da: [], defaults: { de: null, qa: null, da: null } },
      role: 'qa',
      log: noopLogger,
    });

    expect(result).toEqual({ assigned: false, reason: 'empty-role' });
    expect(jira.tryAssign).not.toHaveBeenCalled();
    expect((await eventsRepo.list({ ticketKey: 'PROJ-1' })).events).toHaveLength(0);
  });
});
