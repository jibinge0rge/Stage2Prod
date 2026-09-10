const { defaultBranchName, assertValidBranchName } = require('../../src/lib/branchName');

describe('defaultBranchName', () => {
  it('slugs the summary after the ticket key', () => {
    expect(defaultBranchName('PROJ-101', 'Add DORA framework seed data')).toBe(
      'feat/PROJ-101-add-dora-framework-seed-data'
    );
  });

  it('falls back to feat/key when there is no summary', () => {
    expect(defaultBranchName('PROJ-101', null)).toBe('feat/PROJ-101');
  });
});

describe('assertValidBranchName', () => {
  it('accepts a conventional feat/KEY-slug name', () => {
    expect(assertValidBranchName('feat/PROJ-1-auth', 'PROJ-1')).toBe('feat/PROJ-1-auth');
  });

  it('trims whitespace', () => {
    expect(assertValidBranchName('  feat/PROJ-1  ', 'PROJ-1')).toBe('feat/PROJ-1');
  });

  it('rejects a name that does not contain the ticket key', () => {
    expect(() => assertValidBranchName('feat/something-else', 'PROJ-1')).toThrow(/PROJ-1/);
  });

  it('rejects spaces and path traversal', () => {
    expect(() => assertValidBranchName('feat/PROJ-1 foo', 'PROJ-1')).toThrow(/invalid/);
    expect(() => assertValidBranchName('feat/../PROJ-1', 'PROJ-1')).toThrow(/invalid/);
  });
});
