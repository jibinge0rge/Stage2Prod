const { OUTCOMES, JIRA_COMMENTS } = require('../lib/constants');
const { defaultBranchName, assertValidBranchName } = require('../lib/branchName');
const { syncJiraStatus } = require('../lib/syncJiraStatus');
const { jiraStatusForStage } = require('../lib/statusHandlerMap');

class BranchNotReadyError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

/**
 * Picks the watched repo this ticket's new branch should land in:
 * already-resolved (and still watched), else the unambiguous Jira
 * project-key match, else the only watched repo. Never guesses between
 * two equally-plausible repos.
 */
function resolveRepo({ ticketKey, ticketsRepo, reposRepo, repoResolver }) {
  const row = ticketsRepo.get(ticketKey);
  if (row.repo_owner && reposRepo.isActive(row.repo_owner, row.repo_name)) {
    return { owner: row.repo_owner, name: row.repo_name };
  }
  const byProject = repoResolver.matchByProjectKeyOnly(ticketKey);
  if (byProject) {
    ticketsRepo.setRepo(ticketKey, byProject.owner, byProject.name);
    return byProject;
  }
  const active = reposRepo.list({ activeOnly: true });
  if (active.length === 1) {
    ticketsRepo.setRepo(ticketKey, active[0].owner, active[0].name);
    return { owner: active[0].owner, name: active[0].name };
  }
  return null;
}

async function shaOrNull(github, branch) {
  try {
    return await github.getRef(branch);
  } catch (err) {
    if (err.status === 404) return null;
    throw err;
  }
}

/**
 * Creates a feature branch from the repo's production branch (default)
 * or staging branch. Never force-updates an existing branch — that
 * would wipe work. Called from POST /api/tickets/:key/branch.
 */
async function createBranchFromProduction({
  ticketKey,
  branchName,
  from = 'production',
  ticketsRepo,
  eventsRepo,
  reposRepo,
  repoResolver,
  jira,
  log,
  correlationId,
  trigger = 'POST /api/tickets/:key/branch',
}) {
  const row = ticketsRepo.get(ticketKey);
  if (!row) {
    const err = new Error(`No ticket ${ticketKey}`);
    err.status = 404;
    throw err;
  }

  const source = from === undefined || from === null || from === '' ? 'production' : String(from);
  if (source !== 'production' && source !== 'staging') {
    throw new BranchNotReadyError('"from" must be "production" or "staging"');
  }

  const repo = resolveRepo({ ticketKey, ticketsRepo, reposRepo, repoResolver });
  if (!repo) {
    throw new BranchNotReadyError(
      'Ticket has no resolved repo. Set a Jira project key on the matching watched repo, or watch exactly one repo.'
    );
  }

  const repoConfig = reposRepo.get(repo.owner, repo.name);
  if (!repoConfig) {
    throw new BranchNotReadyError(`${repo.owner}/${repo.name} is not a watched repo`);
  }

  const { productionBranch, stagingBranch } = repoConfig;
  const baseBranch = source === 'staging' ? stagingBranch : productionBranch;
  if (!baseBranch) {
    throw new BranchNotReadyError(
      `This repo has no ${source} branch configured.`
    );
  }
  const name = assertValidBranchName(branchName || defaultBranchName(ticketKey, row.summary), ticketKey);
  if (name === productionBranch || name === stagingBranch) {
    throw new BranchNotReadyError(
      `branch name cannot be this repo's production ("${productionBranch}") or staging ("${stagingBranch}") branch`
    );
  }

  const github = repoResolver.getClient(repo.owner, repo.name);
  const baseSha = await shaOrNull(github, baseBranch);
  if (!baseSha) {
    throw new BranchNotReadyError(
      `${source === 'staging' ? 'Staging' : 'Production'} branch "${baseBranch}" was not found in ${repo.owner}/${repo.name}.`
    );
  }

  let created = false;
  let sha = await shaOrNull(github, name);
  if (!sha) {
    try {
      const result = await github.createRef(name, baseSha);
      sha = result.sha || baseSha;
      created = true;
    } catch (err) {
      // Lost a race with someone else creating the same ref — treat as
      // "already existed" rather than failing the click.
      if (err.status === 422) {
        sha = (await shaOrNull(github, name)) || baseSha;
      } else {
        throw err;
      }
    }
  }

  ticketsRepo.setGithubFacts(ticketKey, { branchName: name, headSha: sha });

  if (created) {
    try {
      await jira.addComment(ticketKey, JIRA_COMMENTS.BRANCH_CREATED(name, baseBranch));
    } catch (err) {
      log?.warn?.({ ticketKey, err: err.message }, 'jira comment after branch create failed; continuing');
    }
    await syncJiraStatus({
      jira,
      ticketsRepo,
      ticketKey,
      status: jiraStatusForStage('in_progress', repoConfig),
      log,
    });
  }

  const sourceLabel = source === 'staging' ? 'staging' : 'production';
  eventsRepo.insertEvent({
    ticketKey,
    trigger,
    action: 'create-branch',
    outcome: OUTCOMES.NOTED,
    title: created ? `Created branch from ${sourceLabel}` : 'Found existing branch',
    detail: created
      ? `Created ${name} from ${baseBranch} @ ${String(baseSha).slice(0, 7)}`
      : `${name} already exists on ${repo.owner}/${repo.name} — recorded on the ticket, not overwritten.`,
    correlationId,
    metadata: { branch: name, sha, from: baseBranch, source, created },
    repoOwner: repo.owner,
    repoName: repo.name,
  });
  log.info({ ticketKey, branch: name, created, sha, from: baseBranch, source }, 'branch ensured');

  return { created, branch: name, sha, repo, from: baseBranch, source };
}

module.exports = { createBranchFromProduction, BranchNotReadyError, resolveRepo };
