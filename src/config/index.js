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
  JIRA_JQL: process.env.JIRA_JQL || 'project = PROJ AND status CHANGED AFTER -5m ORDER BY updated ASC',
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
