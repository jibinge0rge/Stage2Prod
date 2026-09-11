const express = require('express');
const { requireApiToken } = require('../middleware/auth');
const { getRepoInfo } = require('../clients/githubAccount');
const { reclassifyRepoTickets } = require('../services/reclassifyRepoTickets');
const { randomUUID } = require('crypto');

function createReposRouter({ config, reposRepo, ticketsRepo, eventsRepo, repoResolver, logger }) {
  const router = express.Router();
  const log = logger || console;

  router.get('/repos', (req, res) => {
    res.json({ repos: reposRepo.list({ activeOnly: true }) });
  });

  router.post('/repos', requireApiToken, async (req, res, next) => {
    const { owner, name, jiraProjectKey } = req.body || {};
    let { productionBranch, stagingBranch } = req.body || {};
    if (!owner || !name) {
      return res.status(400).json({ error: 'bad_request', message: '"owner" and "name" are required' });
    }
    try {
      const info = await getRepoInfo(config.GITHUB_TOKEN, owner, name);
      if (!info.exists) {
        return res.status(404).json({ error: 'not_found', message: `${owner}/${name} was not found (or the token can't see it)` });
      }
      productionBranch = productionBranch || info.defaultBranch || 'develop';
      stagingBranch = stagingBranch || 'staging';
      if (productionBranch === stagingBranch) {
        return res.status(400).json({ error: 'bad_request', message: 'productionBranch and stagingBranch must be different' });
      }
      const repo = reposRepo.add(owner, name, { productionBranch, stagingBranch, jiraProjectKey });
      return res.status(201).json({ repo });
    } catch (err) {
      return next(err);
    }
  });

  router.patch('/repos/:owner/:name', requireApiToken, async (req, res, next) => {
    const { owner, name } = req.params;
    if (!reposRepo.isActive(owner, name)) {
      return res.status(404).json({ error: 'not_found', message: `${owner}/${name} is not a watched repo` });
    }
    const { productionBranch, stagingBranch, jiraProjectKey } = req.body || {};
    const current = reposRepo.get(owner, name);
    const nextProduction = productionBranch || current.productionBranch;
    const nextStaging = stagingBranch || current.stagingBranch;
    if (nextProduction === nextStaging) {
      return res.status(400).json({ error: 'bad_request', message: 'productionBranch and stagingBranch must be different' });
    }

    const branchesChanged =
      nextProduction !== current.productionBranch || nextStaging !== current.stagingBranch;

    const repo = reposRepo.update(owner, name, { productionBranch, stagingBranch, jiraProjectKey });

    let reclassified = [];
    if (branchesChanged && ticketsRepo && eventsRepo && repoResolver) {
      try {
        reclassified = await reclassifyRepoTickets({
          owner,
          name,
          repoConfig: repo,
          ticketsRepo,
          eventsRepo,
          repoResolver,
          log,
          correlationId: req.correlationId || randomUUID(),
        });
      } catch (err) {
        return next(err);
      }
    }
    return res.json({ repo, reclassified });
  });

  router.delete('/repos/:owner/:name', requireApiToken, (req, res) => {
    reposRepo.remove(req.params.owner, req.params.name);
    res.status(204).end();
  });

  return router;
}

module.exports = { createReposRouter };
