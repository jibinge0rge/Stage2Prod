const {
  normalizeTeamRoles,
  emptyTeamRoles,
  parseStoredTeamRoles,
} = require('../../src/lib/teamRoles');

describe('teamRoles', () => {
  it('normalizes people and dedupes within a role', () => {
    const result = normalizeTeamRoles({
      de: [
        { accountId: 'a1', displayName: 'Ada', avatarUrl: 'https://x/a.png' },
        { accountId: 'a1', displayName: 'Ada again' },
        { accountId: 'a2', displayName: 'Bob', avatarUrls: { '48x48': 'https://x/b.png' } },
      ],
      qa: [{ accountId: 'q1', displayName: 'Quinn' }],
    });
    expect(result.de).toEqual([
      { accountId: 'a1', displayName: 'Ada', avatarUrl: 'https://x/a.png' },
      { accountId: 'a2', displayName: 'Bob', avatarUrl: 'https://x/b.png' },
    ]);
    expect(result.qa).toHaveLength(1);
    expect(result.da).toEqual([]);
  });

  it('rejects unknown roles and bad person shapes', () => {
    expect(() => normalizeTeamRoles({ pm: [] })).toThrow(/Unknown team role/);
    expect(() => normalizeTeamRoles({ de: [{ displayName: 'No id' }] })).toThrow(/accountId/);
  });

  it('clears to empty lists on null', () => {
    expect(normalizeTeamRoles(null)).toEqual(emptyTeamRoles());
  });

  it('parses stored JSON safely', () => {
    expect(parseStoredTeamRoles(null)).toEqual(emptyTeamRoles());
    expect(parseStoredTeamRoles('{not-json')).toEqual(emptyTeamRoles());
    expect(parseStoredTeamRoles(JSON.stringify({ qa: [{ accountId: '1', displayName: 'Q' }] })).qa).toEqual([
      { accountId: '1', displayName: 'Q', avatarUrl: null },
    ]);
  });
});
