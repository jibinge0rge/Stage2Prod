const { countMergedToday } = require('../../web/src/lib/mergedToday.js');

function repoKeyOf(e) {
  return e.repo ? `${e.repo.owner}/${e.repo.name}` : null;
}

const repo = { owner: 'jibingeorge', name: 'test-repo' };

describe('countMergedToday', () => {
  it('counts a ticket that went staging then production today only as production', () => {
    const events = [
      { ticketKey: 'SCRUM-1', action: 'merge:staging', timestamp: '2026-09-10T08:00:00.000Z', repo },
      { ticketKey: 'SCRUM-1', action: 'merge:develop', timestamp: '2026-09-10T13:42:00.000Z', repo },
      { ticketKey: 'SCRUM-4', action: 'merge:staging', timestamp: '2026-09-10T10:00:00.000Z', repo },
    ];
    const counts = countMergedToday(events, new Map(), repoKeyOf);
    expect(counts).toEqual({ toDevelop: 1, toStaging: 1, total: 2 });
  });

  it('does not double-count duplicate merge events for the same ticket', () => {
    const events = [
      { ticketKey: 'SCRUM-4', action: 'merge:staging', timestamp: '2026-09-10T10:00:00.000Z', repo },
      { ticketKey: 'SCRUM-4', action: 'merge:staging', timestamp: '2026-09-10T11:00:00.000Z', repo },
    ];
    expect(countMergedToday(events, new Map(), repoKeyOf).toStaging).toBe(1);
  });

  it('drops staging merges that happened before a staging reset', () => {
    const cutoff = new Date('2026-09-10T12:00:00.000Z').getTime();
    const events = [
      { ticketKey: 'SCRUM-2', action: 'merge:staging', timestamp: '2026-09-10T11:00:00.000Z', repo },
      { ticketKey: 'SCRUM-4', action: 'merge:staging', timestamp: '2026-09-10T13:00:00.000Z', repo },
    ];
    const counts = countMergedToday(events, new Map([['jibingeorge/test-repo', cutoff]]), repoKeyOf);
    expect(counts).toEqual({ toDevelop: 0, toStaging: 1, total: 1 });
  });
});
