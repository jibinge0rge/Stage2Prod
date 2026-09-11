const { OUTCOMES, PIPELINE_STATES, JIRA_COMMENTS } = require('../lib/constants');

class LinkNotReadyError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

function prKey(owner, name, number) {
  return `${owner}/${name}#${number}`;
}

function linkedPrKeys(ticketsRepo, exceptKey) {
  return new Set(
    ticketsRepo
      .list()
      .filter((t) => t.pr_number && t.repo_owner && t.ticket_key !== exceptKey)
      .map((t) => prKey(t.repo_owner, t.repo_name, t.pr_number))
  );
}

function reposForTicket(row, reposRepo) {
  if (row.repo_owner) {
    const cfg = reposRepo.get(row.repo_owner, row.repo_name);
    return [
      {
        owner: row.repo_owner,
        name: row.repo_name,
        productionBranch: cfg?.productionBranch ?? 'develop',
        stagingBranch: cfg?.stagingBranch ?? 'staging',
      },
    ];
  }
  return reposRepo.list({ activeOnly: true });
}

function pipelineStateFor(pr, { stagingBranch, productionBranch }) {
  const toStaging = pr.base === stagingBranch;
  const toProduction = pr.base === productionBranch;
  if (!toStaging && !toProduction) return null;
  if (pr.state === 'open') return toStaging ? PIPELINE_STATES.STAGING_QUEUED : PIPELINE_STATES.QUEUED;
  if (pr.merged) return toStaging ? PIPELINE_STATES.STAGING : PIPELINE_STATES.DEVELOP;
  return null;
}

function targetLabel(pipelineState) {
  if (pipelineState === PIPELINE_STATES.STAGING_QUEUED || pipelineState === PIPELINE_STATES.STAGING) return 'staging';
  return 'production';
}

async function listLinkablePulls({ ticketKey, ticketsRepo, reposRepo, repoResolver }) {
  const row = ticketsRepo.get(ticketKey);
  if (!row) {
    const err = new Error(`No ticket ${ticketKey}`);
    err.status = 404;
    throw err;
  }

  const taken = linkedPrKeys(ticketsRepo, ticketKey);
  const repos = reposForTicket(row, reposRepo);
  const pulls = [];

  for (const repo of repos) {
    const github = repoResolver.getClient(repo.owner, repo.name);
    if (typeof github.listOpenPulls !== 'function') continue;
    const open = await github.listOpenPulls().catch(() => []);
    for (const pr of open) {
      const base = pr.base?.ref;
      if (base !== repo.stagingBranch && base !== repo.productionBranch) continue;
      const number = pr.number;
      if (taken.has(prKey(repo.owner, repo.name, number))) continue;
      pulls.push({
        number,
        title: pr.title,
        headRef: pr.head?.ref,
        baseRef: base,
        url: pr.html_url,
        repo: { owner: repo.owner, name: repo.name },
        target: base === repo.stagingBranch ? 'staging' : 'production',
      });
    }
  }

  return { pulls };
}

/**
 * Attach an existing GitHub PR to a ticket when the branch/title doesn't
 * contain the ticket key, so matcher-based open/merge still works.
 */
async function linkTicketPr({
  ticketKey,
  prNumber,
  owner,
  name,
  ticketsRepo,
  eventsRepo,
  reposRepo,
  repoResolver,
  jira,
  log,
  correlationId,
  trigger = 'POST /api/tickets/:key/pr/link',
}) {
  const row = ticketsRepo.get(ticketKey);
  if (!row) {
    const err = new Error(`No ticket ${ticketKey}`);
    err.status = 404;
    throw err;
  }
  if (row.pr_number) {
    throw new LinkNotReadyError(
      `This ticket is already linked to PR #${row.pr_number}. Close that PR first if you want to attach a different one.`
    );
  }

  const number = Number(prNumber);
  if (!Number.isInteger(number) || number < 1) {
    throw new LinkNotReadyError('"prNumber" must be a positive integer');
  }

  const repoOwner = row.repo_owner || owner;
  const repoName = row.repo_name || name;
  if (!repoOwner || !repoName) {
    throw new LinkNotReadyError('ticket has no resolved repo — pick the watched repo this PR lives in');
  }
  if (row.repo_owner && (owner || name) && (owner !== row.repo_owner || name !== row.repo_name)) {
    throw new LinkNotReadyError(
      `This ticket is already on ${row.repo_owner}/${row.repo_name}. Link a PR from that repo.`
    );
  }

  const repoConfig = reposRepo.get(repoOwner, repoName);
  if (!repoConfig) {
    throw new LinkNotReadyError(`${repoOwner}/${repoName} is not a watched repo`);
  }

  const takenBy = ticketsRepo
    .list()
    .find((t) => t.ticket_key !== ticketKey && t.repo_owner === repoOwner && t.repo_name === repoName && t.pr_number === number);
  if (takenBy) {
    throw new LinkNotReadyError(`PR #${number} is already linked to ${takenBy.ticket_key}`);
  }

  const github = repoResolver.getClient(repoOwner, repoName);
  let pr;
  try {
    pr = await github.getPr(number);
  } catch (err) {
    if (err.status === 404) {
      const missing = new Error(`No pull request #${number} in ${repoOwner}/${repoName}`);
      missing.status = 404;
      throw missing;
    }
    throw err;
  }

  const pipelineState = pipelineStateFor(pr, repoConfig);
  if (!pipelineState) {
    throw new LinkNotReadyError(
      `PR #${number} must be open (or merged) into ${repoConfig.stagingBranch} or ${repoConfig.productionBranch} — this one is ${pr.state} into "${pr.base}".`
    );
  }

  ticketsRepo.setRepo(ticketKey, repoOwner, repoName);
  ticketsRepo.setGithubFacts(ticketKey, {
    branchName: pr.head,
    prNumber: pr.number,
    prState: pr.merged ? 'merged' : pr.state,
    headSha: pr.headSha ?? null,
  });
  if (pr.headSha && typeof github.getCombinedStatus === 'function') {
    const status = await github.getCombinedStatus(pr.headSha).catch(() => null);
    if (status) ticketsRepo.setCheckStatus(ticketKey, status.overall);
  }
  ticketsRepo.setPipelineState(ticketKey, pipelineState);

  const target = targetLabel(pipelineState);
  await jira.addComment(ticketKey, JIRA_COMMENTS.LINKED_PR(pr.number, pr.head, pr.base));
  eventsRepo.insertEvent({
    ticketKey,
    trigger,
    action: target === 'staging' ? 'pr:staging' : 'pr:develop',
    outcome: pr.state === 'open' ? OUTCOMES.PR_OPENED : OUTCOMES.NOTED,
    title: 'Linked existing PR',
    detail: `PR #${pr.number} · ${pr.head} → ${pr.base}`,
    correlationId,
    metadata: { prNumber: pr.number, branch: pr.head, linked: true },
    repoOwner,
    repoName,
  });
  log.info({ ticketKey, prNumber: pr.number, pipelineState }, 'linked existing PR');
  return { linked: true, prNumber: pr.number, pipelineState, target };
}

module.exports = { linkTicketPr, listLinkablePulls, LinkNotReadyError, pipelineStateFor };
