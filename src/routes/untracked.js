const express = require('express');
const { untrackedForRepo } = require('../services/untrackedChanges');

/**
 * GET /api/untracked[?repo=owner/name] — GitHub branches, open PRs, and
 * recent commits on the production branch that don't reference any
 * ticket key Stage2Prod is currently tracking. Read-only, and discloses
 * nothing beyond what /api/branches already does for the same watched
 * repos, so no auth requirement beyond what those routes already have.
 */
function createUntrackedRouter({ reposRepo, displayGithub, ticketsRepo }) {
  const router = express.Router();

  router.get('/untracked', async (req, res, next) => {
    try {
      const activeRepos = reposRepo.list({ activeOnly: true });
      const repoFilter = req.query.repo;
      const repos = repoFilter
        ? activeRepos.filter((r) => `${r.owner}/${r.name}` === repoFilter)
        : activeRepos;

      const ticketKeys = ticketsRepo.list().map((t) => t.ticket_key);

      const results = await Promise.all(
        repos.map((repo) =>
          untrackedForRepo({
            repo,
            github: displayGithub.getClient(repo.owner, repo.name),
            ticketKeys,
          })
        )
      );
      res.json({ repos: results });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = { createUntrackedRouter };
