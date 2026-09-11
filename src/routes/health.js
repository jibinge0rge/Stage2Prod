const express = require('express');
const { refKey } = require('../lib/constants');
const { buildPollJql } = require('../poller/jql');
const { requireApiToken } = require('../middleware/auth');

function createHealthRouter({ config, cursorRepo, lockManager, poller, githubRegistry, reposRepo, jira }) {
  const router = express.Router();

  router.get('/health', (req, res) => {
    const pollState = cursorRepo.get();
    const activeRepos = reposRepo.list({ activeOnly: true });
    const expectedLockKeys = activeRepos.flatMap((r) => [
      refKey(r.owner, r.name, `refs/heads/${r.stagingBranch}`),
      refKey(r.owner, r.name, `refs/heads/${r.productionBranch}`),
    ]);

    res.json({
      watchedRepos: activeRepos.map((r) => ({
        owner: r.owner,
        name: r.name,
        productionBranch: r.productionBranch,
        stagingBranch: r.stagingBranch,
        jiraProjectKey: r.jiraProjectKey,
      })),
      jiraJql: buildPollJql(activeRepos, config),
      jiraHost: config.JIRA_HOST || null,
      jiraEmail: config.JIRA_EMAIL || null,
      poller: {
        running: poller.isRunning(),
        intervalMs: config.POLL_INTERVAL_MS,
        lastPollAt: pollState.last_poll_at,
        lastPollOk: pollState.last_poll_ok === null ? null : !!pollState.last_poll_ok,
        lastError: pollState.last_error,
        nextPollAt: poller.nextPollAt,
        cursor: pollState.cursor,
      },
      jira: {
        rateLimitRemaining: pollState.jira_rate_limit_remaining,
        rateLimitResetAt: pollState.jira_rate_limit_reset_at,
      },
      github: {
        rateLimitRemaining: githubRegistry.rateLimit.remaining,
        rateLimitLimit: githubRegistry.rateLimit.limit,
        rateLimitResetAt: githubRegistry.rateLimit.resetAt,
      },
      locks: lockManager.snapshot(expectedLockKeys),
      dryRun: config.DRY_RUN,
      uptimeSeconds: Math.round(process.uptime()),
    });
  });

  router.post('/sync', requireApiToken, async (req, res, next) => {
    try {
      await poller.pollNow();
      const pollState = cursorRepo.get();
      res.json({
        polled: true,
        poller: {
          lastPollAt: pollState.last_poll_at,
          lastPollOk: pollState.last_poll_ok === null ? null : !!pollState.last_poll_ok,
          lastError: pollState.last_error,
          nextPollAt: poller.nextPollAt,
        },
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = { createHealthRouter };
