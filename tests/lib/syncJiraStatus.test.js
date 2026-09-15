const { syncJiraStatus } = require('../../src/lib/syncJiraStatus');
const { createTestDb, noopLogger } = require('../setup');

describe('syncJiraStatus', () => {
  it('transitions Jira and records the status as last-seen so the poller will not re-fire', async () => {
    const { ticketsRepo } = await createTestDb();
    await ticketsRepo.upsert({ key: 'PROJ-1', jiraStatus: 'To Do', lastSeenStatus: 'To Do' });
    const jira = { tryTransition: vi.fn().mockResolvedValue({ transitioned: true }) };

    const result = await syncJiraStatus({
      jira,
      ticketsRepo,
      ticketKey: 'PROJ-1',
      status: 'In Progress',
      log: noopLogger,
    });

    expect(result).toEqual({ transitioned: true, status: 'In Progress' });
    expect(jira.tryTransition).toHaveBeenCalledWith('PROJ-1', 'In Progress');
    expect((await ticketsRepo.get('PROJ-1')).jira_status).toBe('In Progress');
    expect((await ticketsRepo.get('PROJ-1')).last_seen_status).toBe('In Progress');
  });

  it('does not update last-seen when the transition is not available', async () => {
    const { ticketsRepo } = await createTestDb();
    await ticketsRepo.upsert({ key: 'PROJ-1', jiraStatus: 'To Do', lastSeenStatus: 'To Do' });
    const jira = { tryTransition: vi.fn().mockResolvedValue({ transitioned: false, reason: 'transition-not-available' }) };

    await syncJiraStatus({ jira, ticketsRepo, ticketKey: 'PROJ-1', status: 'In Progress', log: noopLogger });

    expect((await ticketsRepo.get('PROJ-1')).jira_status).toBe('To Do');
    expect((await ticketsRepo.get('PROJ-1')).last_seen_status).toBe('To Do');
  });

  it('swallows thrown errors so a git write is never failed by Jira', async () => {
    const { ticketsRepo } = await createTestDb();
    await ticketsRepo.upsert({ key: 'PROJ-1', jiraStatus: 'To Do' });
    const jira = { transition: vi.fn().mockRejectedValue(new Error('jira down')) };

    await expect(
      syncJiraStatus({ jira, ticketsRepo, ticketKey: 'PROJ-1', status: 'In Progress', log: noopLogger })
    ).resolves.toMatchObject({ transitioned: false, reason: 'error' });
  });

  it('tries Open-stage aliases so To Do is used when Open is not in the workflow', async () => {
    const { ticketsRepo } = await createTestDb();
    await ticketsRepo.upsert({ key: 'PROJ-1', jiraStatus: 'In QA', lastSeenStatus: 'In QA' });
    const jira = {
      tryTransition: vi.fn().mockImplementation(async (_key, name) => {
        if (name === 'To Do') return { transitioned: true };
        return { transitioned: false, reason: 'transition-not-available' };
      }),
    };

    const result = await syncJiraStatus({
      jira,
      ticketsRepo,
      ticketKey: 'PROJ-1',
      statusNames: ['Open', 'To Do', 'Backlog'],
      log: noopLogger,
    });

    expect(result).toMatchObject({ transitioned: true, status: 'To Do' });
    expect(jira.tryTransition).toHaveBeenCalledWith('PROJ-1', 'Open');
    expect(jira.tryTransition).toHaveBeenCalledWith('PROJ-1', 'To Do');
    expect((await ticketsRepo.get('PROJ-1')).jira_status).toBe('To Do');
  });

  it('picks an available destination from getTransitions when several names are given', async () => {
    const { ticketsRepo } = await createTestDb();
    await ticketsRepo.upsert({ key: 'PROJ-1', jiraStatus: 'In QA', lastSeenStatus: 'In QA' });
    const jira = {
      getTransitions: vi.fn().mockResolvedValue([{ id: '21', name: 'Reopen', to: { name: 'To Do' } }]),
      tryTransition: vi.fn().mockResolvedValue({ transitioned: true }),
    };

    const result = await syncJiraStatus({
      jira,
      ticketsRepo,
      ticketKey: 'PROJ-1',
      statusNames: ['Open', 'To Do', 'Backlog'],
      log: noopLogger,
    });

    expect(result).toMatchObject({ transitioned: true, status: 'To Do' });
    expect(jira.tryTransition).toHaveBeenCalledWith('PROJ-1', 'Reopen');
    expect((await ticketsRepo.get('PROJ-1')).jira_status).toBe('To Do');
  });
});
