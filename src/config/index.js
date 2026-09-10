const path = require('path');
require('dotenv').config();

function bool(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  return String(value).toLowerCase() === 'true';
}

function int(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

const config = Object.freeze({
  PORT: int(process.env.PORT, 3000),
  // One token, shared across every repo Stage2Prod watches. Which repos
  // are watched is chosen at runtime (via the UI / POST /api/repos) and
  // persisted in the DB — not fixed in .env.
  GITHUB_TOKEN: process.env.GITHUB_TOKEN || '',
  JIRA_HOST: process.env.JIRA_HOST || '',
  JIRA_EMAIL: process.env.JIRA_EMAIL || '',
  JIRA_API_TOKEN: process.env.JIRA_API_TOKEN || '',
  // Used verbatim only until at least one watched repo has a Jira project
  // key configured (see src/poller/jql.js) — at that point the poller
  // builds its own `project in (...)` query from the repos instead.
  JIRA_JQL: process.env.JIRA_JQL || 'project = PROJ AND (statusCategory != Done OR updated >= -15m) ORDER BY updated ASC',
  // The full open backlog, not just recent deltas — Ticket Pipeline is
  // meant to reflect every open ticket, not only ones that happened to
  // change status in the last poll window. `OR updated >= -15m` is load
  // -bearing, not decorative: a plain `statusCategory != Done` excludes a
  // ticket from every future search the instant it *becomes* Done, which
  // means diffIssues never sees the transition into Done at all — the
  // very query used to detect that transition would have already
  // filtered the ticket out. The OR clause keeps a just-transitioned
  // ticket visible for one last window so the diff (and the resulting
  // toDevelop PR-open) can actually fire, before it drops out of view.
  JIRA_POLL_CLAUSE: process.env.JIRA_POLL_CLAUSE || '(statusCategory != Done OR updated >= -15m)',
  POLL_INTERVAL_MS: int(process.env.POLL_INTERVAL_MS, 60000),
  API_TOKEN: process.env.API_TOKEN || 'local-dev-token',
  DRY_RUN: bool(process.env.DRY_RUN, false),
  DB_PATH: process.env.DB_PATH
    ? path.resolve(process.cwd(), process.env.DB_PATH)
    : path.resolve(process.cwd(), 'data/stage2prod.db'),
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
});

function assertRuntimeConfig() {
  const required = ['GITHUB_TOKEN'];
  const missing = required.filter((key) => !config[key]);
  if (missing.length) {
    // eslint-disable-next-line no-console
    console.warn(
      `[config] missing recommended env vars: ${missing.join(', ')} — GitHub calls will fail until set in .env`
    );
  }
}

module.exports = { config, assertRuntimeConfig };
