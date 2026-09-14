const { projectKeyFromTicket, ticketKeysInText } = require('../../src/lib/jiraKey');

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

describe('ticketKeysInText', () => {
  it('extracts Jira keys from a merge commit message', () => {
    expect(ticketKeysInText('Merge pull request #12 from acme/feat/PROJ-1-login')).toEqual(['PROJ-1']);
  });

  it('dedupes and uppercases keys', () => {
    expect(ticketKeysInText('proj-1 and PROJ-1 and PROJ-2')).toEqual(['PROJ-1', 'PROJ-2']);
  });
});
