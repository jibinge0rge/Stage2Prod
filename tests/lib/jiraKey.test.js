const { projectKeyFromTicket } = require('../../src/lib/jiraKey');

describe('projectKeyFromTicket', () => {
  it('extracts the project key prefix from a ticket key', () => {
    expect(projectKeyFromTicket('PROJ-101')).toBe('PROJ');
  });

  it('handles multi-word project keys with underscores/numbers', () => {
    expect(projectKeyFromTicket('SDS_CLIENT2-42')).toBe('SDS_CLIENT2');
  });

  it('returns the whole string when there is no hyphen', () => {
    expect(projectKeyFromTicket('NOHYPHEN')).toBe('NOHYPHEN');
  });
});
