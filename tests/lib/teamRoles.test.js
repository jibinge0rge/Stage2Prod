const {
  normalizeTeamRoles,
  emptyTeamRoles,
  parseStoredTeamRoles,
  defaultPersonForRole,
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
    expect(result.cdl).toEqual([]);
    expect(result.defaults).toEqual({ de: null, qa: 'q1', da: null, cdl: null });
  });

  it('treats a sole person as the default for that role', () => {
    const result = normalizeTeamRoles({
      de: [{ accountId: 'a1', displayName: 'Ada' }],
      qa: [{ accountId: 'q1', displayName: 'Quinn' }],
    });
    expect(result.defaults).toEqual({ de: 'a1', qa: 'q1', da: null, cdl: null });
  });

  it('keeps an explicit default when a role has several people', () => {
    const result = normalizeTeamRoles({
      qa: [
        { accountId: 'q1', displayName: 'Quinn' },
        { accountId: 'q2', displayName: 'Sam' },
      ],
      defaults: { qa: 'q2' },
    });
    expect(result.defaults.qa).toBe('q2');
  });

  it('rejects a default that is not in that role', () => {
    expect(() =>
      normalizeTeamRoles({
        qa: [{ accountId: 'q1', displayName: 'Quinn' }, { accountId: 'q2', displayName: 'Sam' }],
        defaults: { qa: 'nope' },
      })
    ).toThrow(/defaults\.qa/);
  });

  it('rejects unknown roles and bad person shapes', () => {
    expect(() => normalizeTeamRoles({ pm: [] })).toThrow(/Unknown team role/);
    expect(() => normalizeTeamRoles({ de: [{ displayName: 'No id' }] })).toThrow(/accountId/);
  });

  it('clears to empty lists on null', () => {
    expect(normalizeTeamRoles(null)).toEqual(emptyTeamRoles());
  });

  it('parses stored JSON safely and infers a sole-person default', () => {
    expect(parseStoredTeamRoles(null)).toEqual(emptyTeamRoles());
    expect(parseStoredTeamRoles('{not-json')).toEqual(emptyTeamRoles());
    const parsed = parseStoredTeamRoles(JSON.stringify({ qa: [{ accountId: '1', displayName: 'Q' }] }));
    expect(parsed.qa).toEqual([{ accountId: '1', displayName: 'Q', avatarUrl: null }]);
    expect(parsed.defaults.qa).toBe('1');
  });

  it('defaultPersonForRole returns the sole member or the configured default', () => {
    const sole = normalizeTeamRoles({ qa: [{ accountId: 'q1', displayName: 'Quinn' }] });
    expect(defaultPersonForRole(sole, 'qa').accountId).toBe('q1');

    const many = normalizeTeamRoles({
      qa: [
        { accountId: 'q1', displayName: 'Quinn' },
        { accountId: 'q2', displayName: 'Sam' },
      ],
      defaults: { qa: 'q2' },
    });
    expect(defaultPersonForRole(many, 'qa').accountId).toBe('q2');

    const unset = normalizeTeamRoles({
      qa: [
        { accountId: 'q1', displayName: 'Quinn' },
        { accountId: 'q2', displayName: 'Sam' },
      ],
    });
    expect(defaultPersonForRole(unset, 'qa')).toBeNull();
    expect(defaultPersonForRole(unset, 'de')).toBeNull();
  });

  it('accepts CDL as a role and infers a sole-person default', () => {
    const result = normalizeTeamRoles({
      cdl: [{ accountId: 'c1', displayName: 'Cara' }],
    });
    expect(result.cdl).toEqual([{ accountId: 'c1', displayName: 'Cara', avatarUrl: null }]);
    expect(result.defaults.cdl).toBe('c1');
  });
});
