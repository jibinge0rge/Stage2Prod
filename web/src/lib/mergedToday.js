/**
 * "Merged today" should match the overview board, not the raw event log.
 * A ticket that went staging then production today is only production.
 * Duplicate merge clicks and staging merges wiped by a reset don't count.
 */
export function countMergedToday(mergedEvents, resetCutoffByRepo, repoKeyOf) {
  const toDevelop = new Set();
  const stagingCandidates = [];

  for (const e of mergedEvents) {
    if (!e.ticketKey) continue;
    if (e.action === 'merge:develop') toDevelop.add(e.ticketKey);
    if (e.action === 'merge:staging') stagingCandidates.push(e);
  }

  const toStaging = new Set();
  for (const e of stagingCandidates) {
    if (toDevelop.has(e.ticketKey)) continue;
    const cutoff = resetCutoffByRepo.get(repoKeyOf(e));
    if (cutoff != null && new Date(e.timestamp).getTime() <= cutoff) continue;
    toStaging.add(e.ticketKey);
  }

  return {
    toDevelop: toDevelop.size,
    toStaging: toStaging.size,
    total: toDevelop.size + toStaging.size,
  };
}
