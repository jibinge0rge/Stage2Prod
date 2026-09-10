/**
 * Feature-branch names Stage2Prod can later match back to a ticket.
 * ticketMatcher looks for the ticket key as a substring of the branch
 * name (e.g. feat/PROJ-101-auth), so every name we mint or accept must
 * contain the key.
 */

function slugFromSummary(summary) {
  if (!summary) return '';
  return String(summary)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
}

function defaultBranchName(ticketKey, summary) {
  const slug = slugFromSummary(summary);
  return slug ? `feat/${ticketKey}-${slug}` : `feat/${ticketKey}`;
}

function assertValidBranchName(name, ticketKey) {
  const trimmed = String(name || '').trim();
  if (!trimmed) {
    const err = new Error('branch name is required');
    err.status = 400;
    throw err;
  }
  if (trimmed.length > 200) {
    const err = new Error('branch name is too long (max 200 characters)');
    err.status = 400;
    throw err;
  }
  // GitHub rejects spaces, `..`, control chars, and most specials. Slashes
  // are allowed so `feat/PROJ-101-auth` works. A leading/trailing slash or
  // `.` would make an invalid ref.
  if (
    /[\s~^:?*[\]\\]/.test(trimmed) ||
    trimmed.includes('..') ||
    trimmed.includes('@{') ||
    trimmed.startsWith('/') ||
    trimmed.endsWith('/') ||
    trimmed.startsWith('.') ||
    trimmed.endsWith('.lock')
  ) {
    const err = new Error(`invalid branch name "${trimmed}"`);
    err.status = 400;
    throw err;
  }
  if (!trimmed.includes(ticketKey)) {
    const err = new Error(
      `branch name must contain "${ticketKey}" so Stage2Prod can match it to this ticket later`
    );
    err.status = 400;
    throw err;
  }
  return trimmed;
}

module.exports = { defaultBranchName, assertValidBranchName, slugFromSummary };
