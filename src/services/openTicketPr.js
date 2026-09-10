const { OUTCOMES, refKey } = require('../lib/constants');
const { ensureStagingPrCore } = require('../handlers/toStaging');
const { ensureDevelopPrCore } = require('../handlers/toDevelop');
const { aheadBy } = require('./branchDiff');

class PrNotReadyError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

/**
 * Human-triggered "open a PR" — same lock-free cores the poller uses, so
 * a person can send a ticket to staging (for QA) or to production (after
 * QA approved) without waiting for a Jira status poll. Never merges.
 *
 * `target` is `staging` | `production`.
 */
async function openTicketPr({
  ticketKey,
  target,
  ticketsRepo,
  eventsRepo,
  reposRepo,
  repoResolver,
  jira,
  lockManager,
  log,
  correlationId,
  trigger = 'POST /api/tickets/:key/pr',
}) {
  const row = ticketsRepo.get(ticketKey);
  if (!row) {
    const err = new Error(`No ticket ${ticketKey}`);
    err.status = 404;
    throw err;
  }
  if (target !== 'staging' && target !== 'production') {
    throw new PrNotReadyError('"target" must be "staging" or "production"');
  }
  if (!row.repo_owner) {
    throw new PrNotReadyError('ticket has no resolved repo yet — create a branch first');
  }
  const repoConfig = reposRepo.get(row.repo_owner, row.repo_name);
  if (!repoConfig) {
    throw new PrNotReadyError(`${row.repo_owner}/${row.repo_name} is not a watched repo`);
  }

  const repoOwner = row.repo_owner;
  const repoName = row.repo_name;
  const github = repoResolver.getClient(repoOwner, repoName);
  const ticketMatcher = repoResolver.getMatcher(repoOwner, repoName);
  const targetBranch = target === 'staging' ? repoConfig.stagingBranch : repoConfig.productionBranch;

  const existing = await ticketMatcher.findOpenPrForTicket(ticketKey, { base: targetBranch });
  if (!existing) {
    const branch = row.branch_name || (await ticketMatcher.findBranchForTicket(ticketKey));
    if (!branch) {
      throw new PrNotReadyError(
        `Couldn't open a ${target} PR — no branch containing "${ticketKey}" was found. Create a branch first.`
      );
    }
    const ahead = await aheadBy(github, targetBranch, branch);
    if (ahead < 1) {
      throw new PrNotReadyError(
        `No commits on this branch that aren't already on ${targetBranch}. Push your work first.`
      );
    }
  }

  if (target === 'staging') {
    const result = await lockManager.withLock(
      refKey(repoOwner, repoName, `refs/heads/${repoConfig.stagingBranch}`),
      `openPr:staging:${ticketKey}`,
      correlationId,
      () =>
        ensureStagingPrCore({
          ticketKey,
          log,
          correlationId,
          trigger,
          repoOwner,
          repoName,
          stagingBranch: repoConfig.stagingBranch,
          github,
          jira,
          ticketsRepo,
          eventsRepo,
          ticketMatcher,
        })
    );
    if (result.outcome !== OUTCOMES.PR_OPENED) {
      throw new PrNotReadyError(
        `Couldn't open a staging PR — no branch containing "${ticketKey}" was found. Create a branch first.`
      );
    }
    return { ...result, target: 'staging' };
  }

  const result = await lockManager.withLock(
    refKey(repoOwner, repoName, `refs/heads/${repoConfig.productionBranch}`),
    `openPr:production:${ticketKey}`,
    correlationId,
    () =>
      ensureDevelopPrCore({
        ticketKey,
        log,
        correlationId,
        trigger,
        repoOwner,
        repoName,
        productionBranch: repoConfig.productionBranch,
        github,
        jira,
        ticketsRepo,
        eventsRepo,
        ticketMatcher,
      })
  );
  if (result.outcome !== OUTCOMES.PR_OPENED) {
    throw new PrNotReadyError(
      `Couldn't open a production PR — no branch containing "${ticketKey}" was found. Create a branch first.`
    );
  }
  return { ...result, target: 'production' };
}

module.exports = { openTicketPr, PrNotReadyError };
