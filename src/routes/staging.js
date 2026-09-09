const express = require('express');
const { requireApiToken } = require('../middleware/auth');
const { resetStaging } = require('../services/stagingReset');
const { newCorrelationId } = require('../lib/correlationId');

function createStagingRouter({ reposRepo, repoResolver, jira, ticketsRepo, eventsRepo, lockManager, logger }) {
  const router = express.Router();

  router.post('/staging/reset', requireApiToken, async (req, res, next) => {
    const { owner, name, remergeInQa } = req.body || {};
    if (!owner || !name) {
      return res.status(400).json({ error: 'bad_request', message: '"owner" and "name" are required' });
    }
    if (!reposRepo.isActive(owner, name)) {
      return res.status(400).json({ error: 'unknown_repo', message: `${owner}/${name} is not a watched repo` });
    }

    const repoConfig = reposRepo.get(owner, name);
    const correlationId = newCorrelationId();
    const log = logger.child({ correlationId });
    try {
      const result = await resetStaging({
        owner,
        name,
        productionBranch: repoConfig.productionBranch,
        stagingBranch: repoConfig.stagingBranch,
        remergeInQa: !!remergeInQa,
        correlationId,
        log,
        github: repoResolver.getClient(owner, name),
        jira,
        ticketsRepo,
        eventsRepo,
        lockManager,
        ticketMatcher: repoResolver.getMatcher(owner, name),
      });
      return res.json(result);
    } catch (err) {
      return next(err);
    }
  });

  return router;
}

module.exports = { createStagingRouter };
