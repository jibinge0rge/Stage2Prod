const { diffIssue, diffIssues, extractSprintName } = require('../../src/poller/diff');
const { makeIssue } = require('../fixtures/jiraIssues');

describe('diffIssue', () => {
  it('returns null when status unchanged', () => {
    const issue = makeIssue({ key: 'PROJ-1', status: 'In QA' });
    expect(diffIssue(issue, 'In QA')).toBeNull();
  });

  it('returns an event when status changed', () => {
    const issue = makeIssue({ key: 'PROJ-1', status: 'In QA' });
    const event = diffIssue(issue, 'In Development');
    expect(event).toMatchObject({ ticketKey: 'PROJ-1', newStatus: 'In QA', previousStatus: 'In Development' });
  });

  it('treats a never-seen ticket (lastSeenStatus undefined) as a change', () => {
    const issue = makeIssue({ key: 'PROJ-2', status: 'Ready for QA' });
    const event = diffIssue(issue, undefined);
    expect(event).toMatchObject({ ticketKey: 'PROJ-2', newStatus: 'Ready for QA', previousStatus: null });
  });
});

describe('diffIssues', () => {
  it('orders events oldest-updated-first', () => {
    const issues = [
      makeIssue({ key: 'PROJ-1', status: 'Done', updated: '2026-04-20T15:00:00.000Z' }),
      makeIssue({ key: 'PROJ-2', status: 'Approved', updated: '2026-04-20T13:00:00.000Z' }),
    ];
    const events = diffIssues(issues, () => null);
    expect(events.map((e) => e.ticketKey)).toEqual(['PROJ-2', 'PROJ-1']);
  });

  it('skips issues whose status has not changed', () => {
    const issues = [makeIssue({ key: 'PROJ-1', status: 'In QA' })];
    const events = diffIssues(issues, () => 'In QA');
    expect(events).toHaveLength(0);
  });

  it('still emits an event for unmapped status names — dispatch decides whether to act on it', () => {
    const issues = [makeIssue({ key: 'PROJ-1', status: 'Backlog' })];
    const events = diffIssues(issues, () => 'In Development');
    expect(events).toHaveLength(1);
    expect(events[0].newStatus).toBe('Backlog');
  });
});

describe('extractSprintName', () => {
  it('returns null for no sprint', () => {
    expect(extractSprintName(null)).toBeNull();
  });

  it('picks the active sprint from an array', () => {
    const sprints = [{ name: 'Sprint 33', state: 'closed' }, { name: 'Sprint 34', state: 'active' }];
    expect(extractSprintName(sprints)).toBe('Sprint 34');
  });

  it('falls back to the last sprint when none are active', () => {
    const sprints = [{ name: 'Sprint 33', state: 'closed' }, { name: 'Sprint 34', state: 'closed' }];
    expect(extractSprintName(sprints)).toBe('Sprint 34');
  });
});
