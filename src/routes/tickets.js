const express = require('express');
const { requireApiToken } = require('../middleware/auth');
const { newCorrelationId } = require('../lib/correlationId');
const { mergeOpenPr, MergeNotReadyError } = require('../services/mergeOpenPr');
const { createBranchFromProduction, BranchNotReadyError } = require('../services/createBranch');
const { openTicketPr, PrNotReadyError } = require('../services/openTicketPr');
const { closeTicketPr, CloseNotReadyError } = require('../services/closeTicketPr');
const { compareBranchToTargets } = require('../services/branchDiff');
const { linkTicketPr, listLinkablePulls, LinkNotReadyError } = require('../services/linkTicketPr');
const { reconcileOpenPrBases } = require('../services/reclassifyRepoTickets');

function rowToApi(row, reposRepo) {
  let repo = null;
  if (row.repo_owner) {
    const repoConfig = reposRepo.get(row.repo_owner, row.repo_name);
    repo = {
      owner: row.repo_owner,
      name: row.repo_name,
      productionBranch: repoConfig?.productionBranch ?? 'develop',
      stagingBranch: repoConfig?.stagingBranch ?? 'staging',
    };
  }
  return {
    key: row.ticket_key,
    summary: row.summary,
    branch: row.branch_name,
    jiraStatus: row.jira_status,
    pipelineState: row.pipeline_state,
    prNumber: row.pr_number,
    prState: row.pr_state,
    checkStatus: row.check_status,
    headSha: row.head_sha,
    assignee: row.assignee_name ? { name: row.assignee_name, avatarUrl: row.assignee_avatar_url } : null,
    sprint: row.sprint_name,
    updatedAt: row.updated_at,
    jiraUpdatedAt: row.jira_updated_at,
    repo,
  };
}

async function refreshPendingChecks(rows, { ticketsRepo, repoResolver }) {
  await Promise.all(
    rows
      .filter((r) => r.check_status === 'pending' && r.head_sha && r.repo_owner)
      .map(async (r) => {
        const github = repoResolver.getClient(r.repo_owner, r.repo_name);
        if (typeof github.getCombinedStatus !== 'function') return;
        const status = await github.getCombinedStatus(r.head_sha).catch(() => null);
        if (!status) return;
        ticketsRepo.setCheckStatus(r.ticket_key, status.overall);
        r.check_status = status.overall;
      })
  );
}

function createTicketsRouter({ ticketsRepo, eventsRepo, reposRepo, jira, poller, repoResolver, lockManager, logger }) {
  const router = express.Router();

  router.get('/tickets', async (req, res, next) => {
    try {
      const { state, q, repo } = req.query;
      let rows = ticketsRepo.list();
      if (repo) {
        const [repoOwner, repoName] = String(repo).split('/');
        rows = rows.filter((r) => r.repo_owner === repoOwner && r.repo_name === repoName);
      }
      // Reconcile before state/q filters so a PR retargeted on GitHub
      // (e.g. release → develop) is fixed even when the UI is filtered to
      // the old "Awaiting production" bucket.
      await reconcileOpenPrBases(rows, { ticketsRepo, reposRepo, repoResolver, log: logger });
      if (state && state !== 'all') rows = rows.filter((r) => r.pipeline_state === state);
      if (q) {
        const needle = String(q).toLowerCase();
        rows = rows.filter(
          (r) =>
            r.ticket_key.toLowerCase().includes(needle) ||
            (r.branch_name || '').toLowerCase().includes(needle) ||
            (r.summary || '').toLowerCase().includes(needle) ||
            (r.repo_owner ? `${r.repo_owner}/${r.repo_name}`.toLowerCase().includes(needle) : false)
        );
      }
      await refreshPendingChecks(rows, { ticketsRepo, repoResolver });
      res.json({ tickets: rows.map((r) => rowToApi(r, reposRepo)), total: rows.length });
    } catch (err) {
      next(err);
    }
  });

  router.get('/tickets/:key', async (req, res, next) => {
    const row = ticketsRepo.get(req.params.key);
    if (!row) return res.status(404).json({ error: 'not_found', message: `no ticket ${req.params.key}` });
    try {
      await reconcileOpenPrBases([row], { ticketsRepo, reposRepo, repoResolver, log: logger });
    } catch (err) {
      return next(err);
    }
    const body = { ...rowToApi(row, reposRepo), timeline: eventsRepo.timelineForTicket(req.params.key) };
    if (row.branch_name && row.repo_owner) {
      const repoConfig = reposRepo.get(row.repo_owner, row.repo_name);
      const github = repoResolver.getClient(row.repo_owner, row.repo_name);
      try {
        const diff = await compareBranchToTargets({
          github,
          branch: row.branch_name,
          stagingBranch: repoConfig?.stagingBranch ?? body.repo?.stagingBranch,
          productionBranch: repoConfig?.productionBranch ?? body.repo?.productionBranch,
        });
        body.aheadOfStaging = diff.aheadOfStaging;
        body.aheadOfProduction = diff.aheadOfProduction;
        if (row.head_sha && typeof github.getCombinedStatus === 'function') {
          const status = await github.getCombinedStatus(row.head_sha).catch(() => null);
          if (status) {
            ticketsRepo.setCheckStatus(row.ticket_key, status.overall);
            body.checkStatus = status.overall;
          }
        }
      } catch (err) {
        return next(err);
      }
    } else {
      body.aheadOfStaging = 0;
      body.aheadOfProduction = 0;
    }
    return res.json(body);
  });

  router.get('/tickets/:key/pulls', async (req, res, next) => {
    if (!ticketsRepo.get(req.params.key)) {
      return res.status(404).json({ error: 'not_found', message: `no ticket ${req.params.key}` });
    }
    try {
      const result = await listLinkablePulls({
        ticketKey: req.params.key,
        ticketsRepo,
        reposRepo,
        repoResolver,
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  router.get('/tickets/:key/transitions', async (req, res, next) => {
    if (!ticketsRepo.get(req.params.key)) {
      return res.status(404).json({ error: 'not_found', message: `no ticket ${req.params.key}` });
    }
    try {
      const transitions = await jira.getTransitions(req.params.key);
      res.json({ transitions: transitions.map((t) => ({ id: t.id, name: t.name })) });
    } catch (err) {
      next(err);
    }
  });

  router.post('/tickets/:key/transition', requireApiToken, async (req, res, next) => {
    const { key } = req.params;
    const { name } = req.body || {};
    if (!ticketsRepo.get(key)) return res.status(404).json({ error: 'not_found', message: `no ticket ${key}` });
    if (!name) return res.status(400).json({ error: 'bad_request', message: '"name" (target status) is required' });
    try {
      const result = await jira.transition(key, name);
      if (!result.transitioned) {
        return res.status(400).json({ error: 'bad_request', message: `transition "${name}" is not available for ${key}` });
      }
      // Reflects the transition's effect (e.g. a PR opening) right away
      // instead of waiting up to POLL_INTERVAL_MS for the next tick.
      await poller.pollNow();
      const row = ticketsRepo.get(key);
      return res.json(rowToApi(row, reposRepo));
    } catch (err) {
      return next(err);
    }
  });

  router.post('/tickets/:key/comment', requireApiToken, async (req, res, next) => {
    const { key } = req.params;
    const { text } = req.body || {};
    if (!ticketsRepo.get(key)) return res.status(404).json({ error: 'not_found', message: `no ticket ${key}` });
    if (!text || !text.trim()) return res.status(400).json({ error: 'bad_request', message: '"text" is required' });
    try {
      await jira.addComment(key, text);
      return res.status(201).json({ commented: true });
    } catch (err) {
      return next(err);
    }
  });

  router.post('/tickets/:key/branch', requireApiToken, async (req, res, next) => {
    const { key } = req.params;
    const { name } = req.body || {};
    if (!ticketsRepo.get(key)) return res.status(404).json({ error: 'not_found', message: `no ticket ${key}` });
    const correlationId = newCorrelationId();
    try {
      const result = await createBranchFromProduction({
        ticketKey: key,
        branchName: name,
        ticketsRepo,
        eventsRepo,
        reposRepo,
        repoResolver,
        jira,
        log: logger.child({ correlationId, ticketKey: key }),
        correlationId,
      });
      const updated = ticketsRepo.get(key);
      return res.status(result.created ? 201 : 200).json(rowToApi(updated, reposRepo));
    } catch (err) {
      if (err instanceof BranchNotReadyError || err.status === 400) {
        return res.status(400).json({ error: 'bad_request', message: err.message });
      }
      if (err.status === 404) {
        return res.status(404).json({ error: 'not_found', message: err.message });
      }
      return next(err);
    }
  });

  router.post('/tickets/:key/pr', requireApiToken, async (req, res, next) => {
    const { key } = req.params;
    const { target } = req.body || {};
    if (!ticketsRepo.get(key)) return res.status(404).json({ error: 'not_found', message: `no ticket ${key}` });
    const correlationId = newCorrelationId();
    try {
      await openTicketPr({
        ticketKey: key,
        target,
        ticketsRepo,
        eventsRepo,
        reposRepo,
        repoResolver,
        jira,
        lockManager,
        log: logger.child({ correlationId, ticketKey: key }),
        correlationId,
      });
      const updated = ticketsRepo.get(key);
      return res.status(201).json(rowToApi(updated, reposRepo));
    } catch (err) {
      if (err instanceof PrNotReadyError || err.status === 400) {
        return res.status(400).json({ error: 'bad_request', message: err.message });
      }
      if (err.status === 404) {
        return res.status(404).json({ error: 'not_found', message: err.message });
      }
      return next(err);
    }
  });

  router.post('/tickets/:key/pr/link', requireApiToken, async (req, res, next) => {
    const { key } = req.params;
    const { prNumber, owner, name } = req.body || {};
    if (!ticketsRepo.get(key)) return res.status(404).json({ error: 'not_found', message: `no ticket ${key}` });
    const correlationId = newCorrelationId();
    try {
      await linkTicketPr({
        ticketKey: key,
        prNumber,
        owner,
        name,
        ticketsRepo,
        eventsRepo,
        reposRepo,
        repoResolver,
        jira,
        log: logger.child({ correlationId, ticketKey: key }),
        correlationId,
      });
      const updated = ticketsRepo.get(key);
      return res.json(rowToApi(updated, reposRepo));
    } catch (err) {
      if (err instanceof LinkNotReadyError || err.status === 400) {
        return res.status(400).json({ error: 'bad_request', message: err.message });
      }
      if (err.status === 404) {
        return res.status(404).json({ error: 'not_found', message: err.message });
      }
      return next(err);
    }
  });

  router.post('/tickets/:key/pr/close', requireApiToken, async (req, res, next) => {
    const { key } = req.params;
    const row = ticketsRepo.get(key);
    if (!row) return res.status(404).json({ error: 'not_found', message: `no ticket ${key}` });
    if (!row.repo_owner) {
      return res.status(400).json({ error: 'bad_request', message: 'ticket has no resolved repo yet' });
    }
    const repoConfig = reposRepo.get(row.repo_owner, row.repo_name);
    if (!repoConfig) {
      return res.status(400).json({ error: 'bad_request', message: `${row.repo_owner}/${row.repo_name} is not a watched repo` });
    }
    const correlationId = newCorrelationId();
    try {
      await closeTicketPr({
        ticketKey: key,
        repoOwner: row.repo_owner,
        repoName: row.repo_name,
        productionBranch: repoConfig.productionBranch,
        stagingBranch: repoConfig.stagingBranch,
        github: repoResolver.getClient(row.repo_owner, row.repo_name),
        jira,
        ticketsRepo,
        eventsRepo,
        lockManager,
        log: logger.child({ correlationId, ticketKey: key }),
        correlationId,
      });
      const updated = ticketsRepo.get(key);
      return res.json(rowToApi(updated, reposRepo));
    } catch (err) {
      if (err instanceof CloseNotReadyError || err.status === 400) {
        return res.status(400).json({ error: 'bad_request', message: err.message });
      }
      if (err.status === 409) {
        return res.status(409).json({ error: 'conflict', message: err.message });
      }
      if (err.status === 404) {
        return res.status(404).json({ error: 'not_found', message: err.message });
      }
      return next(err);
    }
  });

  router.post('/tickets/:key/merge', requireApiToken, async (req, res, next) => {
    const { key } = req.params;
    const row = ticketsRepo.get(key);
    if (!row) return res.status(404).json({ error: 'not_found', message: `no ticket ${key}` });
    if (!row.repo_owner) {
      return res.status(400).json({ error: 'bad_request', message: 'ticket has no resolved repo yet' });
    }
    const repoConfig = reposRepo.get(row.repo_owner, row.repo_name);
    if (!repoConfig) {
      return res.status(400).json({ error: 'bad_request', message: `${row.repo_owner}/${row.repo_name} is not a watched repo` });
    }
    const correlationId = newCorrelationId();
    try {
      await mergeOpenPr({
        ticketKey: key,
        repoOwner: row.repo_owner,
        repoName: row.repo_name,
        productionBranch: repoConfig.productionBranch,
        stagingBranch: repoConfig.stagingBranch,
        github: repoResolver.getClient(row.repo_owner, row.repo_name),
        jira,
        ticketsRepo,
        eventsRepo,
        lockManager,
        log: logger.child({ correlationId, ticketKey: key }),
        correlationId,
      });
      const updated = ticketsRepo.get(key);
      return res.json(rowToApi(updated, reposRepo));
    } catch (err) {
      if (err instanceof MergeNotReadyError || err.status === 400) {
        return res.status(400).json({ error: 'bad_request', message: err.message });
      }
      if (err.status === 409) {
        return res.status(409).json({ error: 'conflict', message: err.message });
      }
      return next(err);
    }
  });

  return router;
}

module.exports = { createTicketsRouter, rowToApi };
