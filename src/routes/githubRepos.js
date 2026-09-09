const express = require('express');
const { requireApiToken } = require('../middleware/auth');
const { listAccessibleRepos, listBranchesForRepo } = require('../clients/githubAccount');

function createGithubReposRouter({ config, reposRepo }) {
  const router = express.Router();

  // Both routes below require the API_TOKEN: unlike the app's own
  // tickets/events/branches/health, these reach out and enumerate the
  // operator's full GitHub estate (including private repos not yet
  // added to Stage2Prod) using the server's own token — broader
  // disclosure surface than "what's already been opted in," so it's
  // gated the same way the mutating /api/repos routes are.
  router.get('/github/repos', requireApiToken, async (req, res, next) => {
    try {
      const [accessible, watched] = await Promise.all([
        listAccessibleRepos(config.GITHUB_TOKEN),
        Promise.resolve(reposRepo.list({ activeOnly: true })),
      ]);
      const watchedKeys = new Set(watched.map((r) => `${r.owner}/${r.name}`));
      res.json({
        repos: accessible.map((r) => ({ ...r, watched: watchedKeys.has(`${r.owner}/${r.name}`) })),
      });
    } catch (err) {
      next(err);
    }
  });

  // Used to populate production/staging branch pickers as dropdowns —
  // works for any repo the token can see, watched or not yet watched.
  router.get('/github/repos/:owner/:name/branches', requireApiToken, async (req, res, next) => {
    try {
      const branches = await listBranchesForRepo(config.GITHUB_TOKEN, req.params.owner, req.params.name);
      res.json({ branches });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = { createGithubReposRouter };
