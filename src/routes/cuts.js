const express = require('express');
const { requireApiToken } = require('../middleware/auth');
const { newCorrelationId } = require('../lib/correlationId');
const {
  changelogFromStaging,
  createProductionCut,
  hydrateCut,
  CutNotReadyError,
  syncReleaseCutsFromGithub,
} = require('../services/productionCut');

function createCutsRouter({
  reposRepo,
  cutsRepo,
  ticketsRepo,
  eventsRepo,
  repoResolver,
  lockManager,
  logger,
}) {
  const router = express.Router();

  function requireWatched(owner, name, res) {
    if (!reposRepo.isActive(owner, name)) {
      res.status(404).json({ error: 'not_found', message: `${owner}/${name} is not a watched repo` });
      return false;
    }
    return true;
  }

  router.get('/repos/:owner/:name/cuts', async (req, res, next) => {
    const { owner, name } = req.params;
    if (!requireWatched(owner, name, res)) return;
    if (!cutsRepo) return res.json({ cuts: [] });
    try {
      const repo = reposRepo.get(owner, name);
      const github = repoResolver?.getClient?.(owner, name);
      const cuts = await syncReleaseCutsFromGithub({
        github,
        cutsRepo,
        ticketsRepo,
        owner,
        name,
        stagingBranch: repo?.stagingBranch,
      });
      return res.json({ cuts });
    } catch (err) {
      return next(err);
    }
  });

  router.get('/repos/:owner/:name/cuts/preview', async (req, res, next) => {
    const { owner, name } = req.params;
    if (!requireWatched(owner, name, res)) return;
    try {
      const preview = await changelogFromStaging({
        owner,
        name,
        reposRepo,
        cutsRepo,
        ticketsRepo,
        repoResolver,
      });
      return res.json(preview);
    } catch (err) {
      if (err instanceof CutNotReadyError || err.status === 400) {
        return res.status(400).json({ error: 'bad_request', message: err.message });
      }
      if (err.status === 404) {
        return res.status(404).json({ error: 'not_found', message: err.message });
      }
      return next(err);
    }
  });

  router.get('/repos/:owner/:name/cuts/:id', async (req, res, next) => {
    const { owner, name, id } = req.params;
    if (!requireWatched(owner, name, res)) return;
    if (!cutsRepo) return res.status(404).json({ error: 'not_found', message: 'no such cut' });
    try {
      const repo = reposRepo.get(owner, name);
      const github = repoResolver?.getClient?.(owner, name);
      await syncReleaseCutsFromGithub({
        github,
        cutsRepo,
        ticketsRepo,
        owner,
        name,
        stagingBranch: repo?.stagingBranch,
      });
      const cut = cutsRepo.get(Number(id));
      if (!cut || cut.repoOwner !== owner || cut.repoName !== name) {
        return res.status(404).json({ error: 'not_found', message: `no cut ${id} on ${owner}/${name}` });
      }
      return res.json({ cut: hydrateCut(cut, ticketsRepo) });
    } catch (err) {
      return next(err);
    }
  });

  router.post('/repos/:owner/:name/cuts', requireApiToken, async (req, res, next) => {
    const { owner, name } = req.params;
    if (!requireWatched(owner, name, res)) return;
    const correlationId = newCorrelationId();
    try {
      const cut = await createProductionCut({
        owner,
        name,
        branchName: req.body?.name,
        reposRepo,
        cutsRepo,
        ticketsRepo,
        eventsRepo,
        repoResolver,
        lockManager,
        log: logger?.child?.({ correlationId, owner, name }) || logger,
        correlationId,
      });
      return res.status(201).json({ cut });
    } catch (err) {
      if (err instanceof CutNotReadyError || err.status === 400) {
        return res.status(400).json({ error: 'bad_request', message: err.message });
      }
      if (err.status === 404) {
        return res.status(404).json({ error: 'not_found', message: err.message });
      }
      return next(err);
    }
  });

  return router;
}

module.exports = { createCutsRouter };
