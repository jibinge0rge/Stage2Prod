/**
 * Jira issue keys are always `{PROJECT_KEY}-{number}` (e.g. "PROJ-101"),
 * so the project a ticket belongs to can be read straight off its key —
 * no extra Jira field/lookup needed.
 */
function projectKeyFromTicket(ticketKey) {
  const idx = ticketKey.indexOf('-');
  return idx === -1 ? ticketKey : ticketKey.slice(0, idx);
}

const JIRA_KEY_RE = /\b([A-Z][A-Z0-9]+-\d+)\b/gi;

function ticketKeysInText(text) {
  if (!text) return [];
  const keys = [];
  const seen = new Set();
  let match;
  const re = new RegExp(JIRA_KEY_RE.source, JIRA_KEY_RE.flags);
  while ((match = re.exec(text))) {
    const key = match[1].toUpperCase();
    if (!seen.has(key)) {
      seen.add(key);
      keys.push(key);
    }
  }
  return keys;
}

module.exports = { projectKeyFromTicket, ticketKeysInText };
