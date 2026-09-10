function slugFromSummary(summary) {
  if (!summary) return '';
  return String(summary)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
}

export function defaultBranchName(ticketKey, summary) {
  const slug = slugFromSummary(summary);
  return slug ? `feat/${ticketKey}-${slug}` : `feat/${ticketKey}`;
}
