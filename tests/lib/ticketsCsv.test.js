const { csvEscape, ticketsToCsv, downloadFilename } = require('../../web/src/lib/ticketsCsv.js');

describe('csvEscape', () => {
  it('quotes commas and doubled quotes', () => {
    expect(csvEscape('Harden OAuth, token refresh')).toBe('"Harden OAuth, token refresh"');
    expect(csvEscape('Say "hello"')).toBe('"Say ""hello"""');
  });
});

describe('ticketsToCsv', () => {
  it('writes a BOM and one row per ticket', () => {
    const csv = ticketsToCsv([
      {
        key: 'SCRUM-1',
        summary: 'Task 1',
        jiraStatus: 'Done',
        pipelineState: 'develop',
        repo: { owner: 'acme', name: 'widgets' },
        branch: 'feat/SCRUM-1',
        prNumber: 12,
        checkStatus: 'passing',
        assignee: { name: 'Ada' },
        sprint: 'Sprint 1',
        updatedAt: '2026-09-11T05:00:00.000Z',
      },
    ]);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('Ticket,Summary,Jira status,Pipeline');
    expect(csv).toContain('SCRUM-1,Task 1,Done,Merged to develop,acme/widgets,feat/SCRUM-1,#12,passing,Ada,Sprint 1,2026-09-11T05:00:00.000Z');
  });
});

describe('downloadFilename', () => {
  it('slugs the slice name and stamps the date', () => {
    expect(downloadFilename('In production', new Date('2026-09-11T10:00:00.000Z'))).toBe(
      'tickets-in-production-2026-09-11.csv'
    );
  });
});
