const { OUTCOMES, PIPELINE_STATES, JIRA_COMMENTS } = require('../lib/constants');
const { syncJiraStatus } = require('../lib/syncJiraStatus');
const { jiraStatusForStage, namesForStage } = require('../lib/statusHandlerMap');

const SKIP_STATES = new Set([PIPELINE_STATES.DEVELOP]);

async function refExists(github, branch) {
  if (!github || typeof github.getRef !== 'function' || !branch) return null;
  try {
    await github.getRef(branch);
    return true;
  } catch (err) {
    if (err.status === 404) return false;
    return null;
  }
}

/**
 * If the ticket's feature branch (and any unmerged PR) were deleted on
 * GitHub, clear local git pointers and move Jira back to the mapped Open
 * / To Do status so Create branch is offered again.
 *
 * Leaves shipped tickets (merged to production) and still-open PRs alone.
 * Never throws — a GitHub blip must not fail the ticket drawer.
 */
async function reconcileGoneBranch({
  row,
  ticketsRepo,
  eventsRepo,
  reposRepo,
  repoResolver,
  jira,
  log,
  trigger = 'GET /api/tickets/:key',
}) {
  if (!row?.branch_name || !row.repo_owner) return false;
  if (SKIP_STATES.has(row.pipeline_state)) return false;

  const github = repoResolver?.getClient?.(row.repo_owner, row.repo_name);
  const exists = await refExists(github, row.branch_name);
  if (exists !== false) return false;

  if (row.pr_number) {
    if (!github || typeof github.getPr !== 'function') return false;
    try {
      const pr = await github.getPr(row.pr_number);
      if (pr && (pr.state === 'open' || pr.merged)) return false;
    } catch (err) {
      if (err.status !== 404) return false;
    }
  }

  const ticketKey = row.ticket_key;
  const goneBranch = row.branch_name;
  const repoConfig = reposRepo?.get?.(row.repo_owner, row.repo_name);
  const statusMap = repoConfig?.effectiveStatusHandlerMap || repoConfig?.statusHandlerMap;
  const openNames = namesForStage('open', statusMap);
  const openStatus = openNames[0] || jiraStatusForStage('open', statusMap);

  ticketsRepo.clearFeatureWork(ticketKey);

  eventsRepo?.insertEvent?.({
    ticketKey,
    trigger,
    action: 'reset',
    outcome: OUTCOMES.RESET,
    title: 'Feature branch gone — reset to To Do',
    detail: `\`${goneBranch}\` was not found on GitHub. Pipeline cleared so a new branch can be created.`,
    metadata: { branch: goneBranch, previousState: row.pipeline_state },
    repoOwner: row.repo_owner,
    repoName: row.repo_name,
  });

  try {
    await jira?.addComment?.(ticketKey, JIRA_COMMENTS.FEATURE_WORK_GONE(goneBranch, openStatus));
  } catch (err) {
    log?.warn?.({ ticketKey, err: err.message }, 'jira comment after gone-branch reset failed; continuing');
  }

  await syncJiraStatus({
    jira,
    ticketsRepo,
    ticketKey,
    status: openStatus,
    statusNames: openNames,
    log,
  });

  log?.info?.({ ticketKey, branch: goneBranch }, 'feature branch gone; ticket reset to To Do');
  return true;
}

module.exports = { reconcileGoneBranch };
