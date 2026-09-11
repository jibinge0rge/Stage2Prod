const { initialsFromEmail } = require('../../web/src/lib/initialsFromEmail.js');

describe('initialsFromEmail', () => {
  it('uses the first letter of each dotted name part', () => {
    expect(initialsFromEmail('jibin.george@work.com')).toBe('JG');
  });

  it('falls back to the first two letters of a single local part', () => {
    expect(initialsFromEmail('ada@work.com')).toBe('AD');
  });

  it('returns empty when there is no usable email', () => {
    expect(initialsFromEmail('')).toBe('');
    expect(initialsFromEmail(null)).toBe('');
    expect(initialsFromEmail('not-an-email')).toBe('');
  });
});
