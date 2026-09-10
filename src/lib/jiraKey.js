/**
 * Jira issue keys are always `{PROJECT_KEY}-{number}` (e.g. "PROJ-101"),
 * so the project a ticket belongs to can be read straight off its key —
 * no extra Jira field/lookup needed.
 */
function projectKeyFromTicket(ticketKey) {
  const idx = ticketKey.indexOf('-');
  return idx === -1 ? ticketKey : ticketKey.slice(0, idx);
}

module.exports = { projectKeyFromTicket };
