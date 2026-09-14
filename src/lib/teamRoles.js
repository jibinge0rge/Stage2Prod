/** App-configured team roles per watched repo. Multiple people per role. */
const TEAM_ROLE_IDS = Object.freeze(['de', 'qa', 'da', 'cdl']);

const TEAM_ROLE_META = Object.freeze({
  de: { id: 'de', label: 'DE', detail: 'Assigned when a staging→production PR is opened' },
  qa: { id: 'qa', label: 'QA', detail: 'Assigned when a ticket enters In QA' },
  da: { id: 'da', label: 'DA', detail: 'DA for this repo' },
  cdl: { id: 'cdl', label: 'CDL', detail: 'CDL for this repo' },
});

function emptyDefaults() {
  return { de: null, qa: null, da: null, cdl: null };
}

function emptyTeamRoles() {
  return { de: [], qa: [], da: [], cdl: [], defaults: emptyDefaults() };
}

function normalizePerson(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const accountId = String(raw.accountId || '').trim();
  if (!accountId) return null;
  const displayName = String(raw.displayName || raw.name || accountId).trim();
  const avatarUrl =
    raw.avatarUrl ||
    raw.avatarUrls?.['48x48'] ||
    raw.avatarUrls?.['32x32'] ||
    raw.avatarUrls?.['24x24'] ||
    null;
  return {
    accountId,
    displayName,
    avatarUrl: avatarUrl ? String(avatarUrl) : null,
  };
}

function requestedDefaultId(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'string') return raw.trim() || null;
  if (typeof raw === 'object' && raw.accountId) return String(raw.accountId).trim() || null;
  return null;
}

function resolveDefaultAccountId(role, people, requestedId) {
  if (people.length === 0) {
    if (requestedId) {
      const err = new Error(`teamRoles.defaults.${role} must be one of the people in that role`);
      err.status = 400;
      throw err;
    }
    return null;
  }
  if (people.length === 1) {
    if (requestedId && requestedId !== people[0].accountId) {
      const err = new Error(`teamRoles.defaults.${role} must be the sole person in that role`);
      err.status = 400;
      throw err;
    }
    return people[0].accountId;
  }
  if (!requestedId) return null;
  if (!people.some((p) => p.accountId === requestedId)) {
    const err = new Error(`teamRoles.defaults.${role} must be one of the people in that role`);
    err.status = 400;
    throw err;
  }
  return requestedId;
}

/**
 * Accepts `{ de: [...], qa: [...], da: [...], cdl: [...], defaults?: { de, qa, da, cdl } }`
 * (or partial) and returns a normalized object. Dedupes by accountId within
 * each role. A role with exactly one person is always that role's default.
 * `null` / empty clears to empty lists. Throws on unknown role keys or
 * bad person shapes.
 */
function normalizeTeamRoles(input) {
  if (input === undefined) return undefined;
  if (input === null || input === '') return emptyTeamRoles();
  if (typeof input !== 'object' || Array.isArray(input)) {
    const err = new Error('teamRoles must be an object of { de, qa, da, cdl: Person[], defaults? }');
    err.status = 400;
    throw err;
  }

  for (const key of Object.keys(input)) {
    if (!TEAM_ROLE_IDS.includes(key) && key !== 'defaults') {
      const err = new Error(`Unknown team role "${key}". Use one of: ${TEAM_ROLE_IDS.join(', ')}`);
      err.status = 400;
      throw err;
    }
  }

  if (input.defaults != null && (typeof input.defaults !== 'object' || Array.isArray(input.defaults))) {
    const err = new Error('teamRoles.defaults must be an object of { de, qa, da, cdl: accountId }');
    err.status = 400;
    throw err;
  }

  const out = emptyTeamRoles();
  for (const role of TEAM_ROLE_IDS) {
    const list = input[role];
    if (list === undefined || list === null) continue;
    if (!Array.isArray(list)) {
      const err = new Error(`teamRoles.${role} must be an array of people`);
      err.status = 400;
      throw err;
    }
    const seen = new Set();
    for (const raw of list) {
      const person = normalizePerson(raw);
      if (!person) {
        const err = new Error(`teamRoles.${role} entries need an accountId`);
        err.status = 400;
        throw err;
      }
      if (seen.has(person.accountId)) continue;
      seen.add(person.accountId);
      out[role].push(person);
    }
  }

  for (const role of TEAM_ROLE_IDS) {
    out.defaults[role] = resolveDefaultAccountId(role, out[role], requestedDefaultId(input.defaults?.[role]));
  }
  return out;
}

function parseStoredTeamRoles(json) {
  if (!json) return emptyTeamRoles();
  try {
    return normalizeTeamRoles(JSON.parse(json)) || emptyTeamRoles();
  } catch {
    return emptyTeamRoles();
  }
}

/** Person auto-assignment should use for a role, or null if none is configured. */
function defaultPersonForRole(teamRoles, role) {
  if (!teamRoles || !TEAM_ROLE_IDS.includes(role)) return null;
  const people = teamRoles[role] || [];
  if (people.length === 0) return null;
  if (people.length === 1) return people[0];
  const defaultId = teamRoles.defaults?.[role];
  if (!defaultId) return null;
  return people.find((p) => p.accountId === defaultId) || null;
}

module.exports = {
  TEAM_ROLE_IDS,
  TEAM_ROLE_META,
  emptyDefaults,
  emptyTeamRoles,
  normalizePerson,
  normalizeTeamRoles,
  parseStoredTeamRoles,
  defaultPersonForRole,
};
