/**
 * Dev convenience only — NOT part of the runtime app. Populates the
 * SQLite DB with mockup-shaped sample tickets/events so the dashboard
 * has realistic data to click through without live Jira/GitHub access.
 * Run with `npm run seed`.
 */
const { config } = require('../config');
const { createDb } = require('./index');
const { createTicketsRepo } = require('./repositories/ticketsRepo');
const { createEventsRepo } = require('./repositories/eventsRepo');
const { createCursorRepo } = require('./repositories/cursorRepo');
const { createReposRepo } = require('./repositories/reposRepo');

const DEMO_REPO = { owner: 'test-org', name: 'test-repo' };

const TICKETS = [
  { key: 'PROJ-124', summary: 'Add DORA framework seed data', branch: 'feat/PROJ-124-dora-seed', jira: 'Approved', state: 'queued', pr: 1450, checks: 'passing', author: 'L. Chen', sprint: 'Sprint 34' },
  { key: 'PROJ-118', summary: 'Harden OAuth token refresh', branch: 'feat/PROJ-118-auth-refresh', jira: 'In QA', state: 'staging', pr: 1442, checks: 'passing', author: 'A. Rao', sprint: 'Sprint 34' },
  { key: 'PROJ-121', summary: 'Paginate findings export', branch: 'feat/PROJ-121-export-pagination', jira: 'In QA', state: 'staging', pr: 1447, checks: 'passing', author: 'M. Patel', sprint: 'Sprint 34' },
  { key: 'PROJ-127', summary: 'Knowledge graph edge weight recompute', branch: 'feat/PROJ-127-kg-edges', jira: 'In QA', state: 'staging', pr: 1452, checks: 'passing', author: 'J. Okafor', sprint: 'Sprint 34' },
  { key: 'PROJ-109', summary: 'Fix CIS control mapping drift', branch: 'feat/PROJ-109-cis-drift', jira: 'Ready for QA', state: 'conflict', pr: 1431, checks: 'passing', author: 'D. Whitfield', sprint: 'Sprint 34' },
  { key: 'PROJ-131', summary: 'Asset dedupe on serial number', branch: 'feat/PROJ-131-asset-dedupe', jira: 'QA Failed', state: 'rejected', pr: 1455, checks: 'failing', author: 'S. Iyer', sprint: 'Sprint 34' },
  { key: 'PROJ-133', summary: 'Remove legacy SOX report', branch: 'feat/PROJ-133-sox-cleanup', jira: 'Ready for Release', state: 'queued', pr: 1458, checks: 'pending', author: 'L. Chen', sprint: 'Sprint 34' },
  { key: 'PROJ-136', summary: 'Identity risk scoring v2', branch: 'feat/PROJ-136-identity-risk', jira: 'In Development', state: 'unmerged', pr: null, checks: null, author: 'S. Iyer', sprint: 'Sprint 34' },
  { key: 'PROJ-102', summary: 'Rate-limit webhook receiver', branch: 'feat/PROJ-102-rate-limit', jira: 'Done', state: 'develop', pr: 1408, checks: 'passing', author: 'A. Rao', sprint: 'Sprint 33' },
  { key: 'PROJ-096', summary: 'Cache EPSS score lookups', branch: 'feat/PROJ-096-epss-cache', jira: 'Done', state: 'develop', pr: 1399, checks: 'passing', author: 'D. Whitfield', sprint: 'Sprint 33' },
];

const LOG = [
  { minsAgo: 0, ticket: 'PROJ-124', trigger: 'Poll · status change', action: 'merge:develop', outcome: 'MERGED', title: 'Merged into develop', detail: 'Merged PR #1450 into develop, deleted feat/PROJ-124-dora-seed' },
  { minsAgo: 12, ticket: 'PROJ-133', trigger: 'Poll · status change', action: 'merge:develop', outcome: 'HELD', title: 'Held develop merge', detail: 'Held develop merge — status check pending' },
  { minsAgo: 34, ticket: 'PROJ-127', trigger: 'Poll · status change', action: 'merge:staging', outcome: 'MERGED', title: 'Merged into staging', detail: 'Merged feat/PROJ-127-kg-edges into staging' },
  { minsAgo: 50, ticket: 'PROJ-131', trigger: 'Poll · status change', action: 'label', outcome: 'NOTED', title: 'QA failed — no revert performed', detail: 'Labelled PR #1455 qa-rejected, no git action' },
  { minsAgo: 64, ticket: 'PROJ-109', trigger: 'Poll · status change', action: 'merge:staging', outcome: 'CONFLICT', title: 'Merge into staging failed', detail: 'Merge into staging rejected by GitHub (409 conflict)' },
  { minsAgo: 87, ticket: 'PROJ-121', trigger: 'Poll · status change', action: 'merge:staging', outcome: 'MERGED', title: 'Merged into staging', detail: 'Merged feat/PROJ-121-export-pagination into staging' },
  { minsAgo: 108, ticket: 'PROJ-118', trigger: 'Poll · status change', action: 'merge:staging', outcome: 'MERGED', title: 'Merged into staging', detail: 'Merged feat/PROJ-118-auth-refresh into staging' },
  { minsAgo: 160, ticket: 'PROJ-102', trigger: 'Poll · status change', action: 'merge:develop', outcome: 'MERGED', title: 'Merged into develop', detail: 'Merged PR #1408 into develop, deleted feat/PROJ-102-rate-limit' },
  { minsAgo: 192, ticket: null, trigger: 'POST /api/staging/reset', action: 'reset-ref', outcome: 'RESET', title: 'Force-updated staging to develop', detail: 'Force-updated refs/heads/staging to develop a91f3c2' },
  { minsAgo: 192, ticket: null, trigger: 'Ref lock', action: 'lock', outcome: 'LOCK', title: 'Acquired lock on refs/heads/staging', detail: 'Acquired lock on refs/heads/staging (held 1.4s)' },
  { minsAgo: 260, ticket: 'PROJ-136', trigger: 'Poll · status change', action: 'label', outcome: 'NOTED', title: 'No git action taken', detail: 'In Development — comment posted, branch left unmerged' },
];

function run() {
  const db = createDb(config.DB_PATH);
  const ticketsRepo = createTicketsRepo(db);
  const eventsRepo = createEventsRepo(db);
  const cursorRepo = createCursorRepo(db);
  const reposRepo = createReposRepo(db);

  const now = Date.now();

  reposRepo.add(DEMO_REPO.owner, DEMO_REPO.name);

  for (const t of TICKETS) {
    ticketsRepo.upsert({
      key: t.key,
      repoOwner: DEMO_REPO.owner,
      repoName: DEMO_REPO.name,
      summary: t.summary,
      jiraStatus: t.jira,
      lastSeenStatus: t.jira,
      pipelineState: t.state,
      branchName: t.branch,
      prNumber: t.pr,
      prState: t.pr ? 'open' : null,
      checkStatus: t.checks,
      headSha: t.pr ? `${t.key.toLowerCase()}sha`.slice(0, 7) : null,
      assigneeName: t.author,
      sprintName: t.sprint,
      jiraUpdatedAt: new Date(now - 15 * 60 * 1000).toISOString(),
    });
  }

  for (const e of [...LOG].reverse()) {
    eventsRepo.insertEvent({
      ticketKey: e.ticket,
      trigger: e.trigger,
      action: e.action,
      outcome: e.outcome,
      title: e.title,
      detail: e.detail,
      correlationId: null,
      metadata: null,
      repoOwner: e.ticket ? DEMO_REPO.owner : null,
      repoName: e.ticket ? DEMO_REPO.name : null,
    });
  }

  cursorRepo.setCursor(new Date(now - 2 * 60 * 1000).toISOString());
  cursorRepo.recordPoll({ ok: true, error: null });
  cursorRepo.setJiraRateLimit({ remaining: 9410, resetAt: new Date(now + 30 * 60 * 1000).toISOString() });

  // eslint-disable-next-line no-console
  console.log(
    `Seeded ${TICKETS.length} tickets, ${LOG.length} events, and 1 watched repo (${DEMO_REPO.owner}/${DEMO_REPO.name}) into ${config.DB_PATH}`
  );
  db.close();
}

run();
