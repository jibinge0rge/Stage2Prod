const { syncJiraStatus } = require('../../src/lib/syncJiraStatus');
const { createTestDb, noopLogger } = require('../setup');

describe('syncJiraStatus', () => {
  it('transitions Jira and records the status as last-seen so the poller will not re-fire', async () => {
    const { ticketsRepo } = createTestDb();
    ticketsRepo.upsert({ key: 'PROJ-1', jiraStatus: 'To Do', lastSeenStatus: 'To Do' });
    const jira = { tryTransition: vi.fn().mockResolvedValue({ transitioned: true }) };

    const result = await syncJiraStatus({
      jira,
      ticketsRepo,
      ticketKey: 'PROJ-1',
      status: 'In Progress',
      log: noopLogger,
    });

    expect(result).toEqual({ transitioned: true });
    expect(jira.tryTransition).toHaveBeenCalledWith('PROJ-1', 'In Progress');
    expect(ticketsRepo.get('PROJ-1').jira_status).toBe('In Progress');
    expect(ticketsRepo.get('PROJ-1').last_seen_status).toBe('In Progress');
  });

  it('does not update last-seen when the transition is not available', async () => {
    const { ticketsRepo } = createTestDb();
    ticketsRepo.upsert({ key: 'PROJ-1', jiraStatus: 'To Do', lastSeenStatus: 'To Do' });
    const jira = { tryTransition: vi.fn().mockResolvedValue({ transitioned: false, reason: 'transition-not-available' }) };

    await syncJiraStatus({ jira, ticketsRepo, ticketKey: 'PROJ-1', status: 'In Progress', log: noopLogger });

    expect(ticketsRepo.get('PROJ-1').jira_status).toBe('To Do');
    expect(ticketsRepo.get('PROJ-1').last_seen_status).toBe('To Do');
  });

  it('swallows thrown errors so a git write is never failed by Jira', async () => {
    const { ticketsRepo } = createTestDb();
    ticketsRepo.upsert({ key: 'PROJ-1', jiraStatus: 'To Do' });
    const jira = { transition: vi.fn().mockRejectedValue(new Error('jira down')) };

    await expect(
      syncJiraStatus({ jira, ticketsRepo, ticketKey: 'PROJ-1', status: 'In Progress', log: noopLogger })
    ).resolves.toMatchObject({ transitioned: false, reason: 'error' });
  });
});
