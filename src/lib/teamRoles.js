/** App-configured team roles per watched repo. Multiple people per role. */
const TEAM_ROLE_IDS = Object.freeze(['de', 'qa', 'da']);

const TEAM_ROLE_META = Object.freeze({
  de: { id: 'de', label: 'DE', detail: 'Developers for this repo' },
  qa: { id: 'qa', label: 'QA', detail: 'QA for this repo' },
  da: { id: 'da', label: 'DA', detail: 'DA for this repo' },
});

function emptyTeamRoles() {
  return { de: [], qa: [], da: [] };
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

/**
 * Accepts `{ de: [...], qa: [...], da: [...] }` (or partial) and returns a
 * normalized object. Dedupes by accountId within each role. `null` / empty
 * clears to empty lists. Throws on unknown role keys or bad person shapes.
 */
function normalizeTeamRoles(input) {
  if (input === undefined) return undefined;
  if (input === null || input === '') return emptyTeamRoles();
  if (typeof input !== 'object' || Array.isArray(input)) {
    const err = new Error('teamRoles must be an object of { de, qa, da: Person[] }');
    err.status = 400;
    throw err;
  }

  for (const key of Object.keys(input)) {
    if (!TEAM_ROLE_IDS.includes(key)) {
      const err = new Error(`Unknown team role "${key}". Use one of: ${TEAM_ROLE_IDS.join(', ')}`);
      err.status = 400;
      throw err;
    }
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

module.exports = {
  TEAM_ROLE_IDS,
  TEAM_ROLE_META,
  emptyTeamRoles,
  normalizePerson,
  normalizeTeamRoles,
  parseStoredTeamRoles,
};
