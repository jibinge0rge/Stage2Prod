const { OUTCOMES, PIPELINE_STATES, JIRA_COMMENTS } = require('../lib/constants');

/**
 * No ref writes — no revert, no cherry-pick. Comments on Jira and labels
 * the PR qa-rejected. Never touches the mutex since it makes no ref writes.
 */
async function rejected({ event, log, correlationId, repoOwner, repoName, github, jira, ticketsRepo, eventsRepo, ticketMatcher }) {
  const trigger = `Poll · status change`;
  const pr = await ticketMatcher.findOpenPrForTicket(event.ticketKey, {});

  await jira.addComment(event.ticketKey, JIRA_COMMENTS.REJECTED);

  if (pr) {
    await github.addLabel(pr.number, 'qa-rejected');
    ticketsRepo.setGithubFacts(event.ticketKey, { branchName: pr.head.ref, prNumber: pr.number });
  }

  ticketsRepo.setPipelineState(event.ticketKey, PIPELINE_STATES.REJECTED);
  eventsRepo.insertEvent({
    ticketKey: event.ticketKey,
    trigger,
    action: 'label',
    outcome: OUTCOMES.NOTED,
    title: pr ? `QA failed — no revert performed` : 'Feature rejected — no matching PR to label',
    detail: pr ? `PR #${pr.number} labelled qa-rejected` : 'Branch remains unmerged into develop.',
    correlationId,
    metadata: pr ? { prNumber: pr.number } : null,
    repoOwner,
    repoName,
  });
  log.info({ ticketKey: event.ticketKey, prNumber: pr?.number }, 'ticket rejected, no git action taken');
  return { outcome: OUTCOMES.NOTED };
}

module.exports = { rejected };
