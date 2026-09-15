const express = require('express');
const { reconcileOpenPrBases } = require('../services/reclassifyRepoTickets');
const { reconcileMergeConflicts } = require('../services/syncPrMergeability');
const { syncReleaseCutsFromGithub } = require('../services/productionCut');

function formatTime(iso) {
  if (!iso) return '';
  return new Date(iso).toISOString().slice(11, 16);
}

function statusLabelFor(row, side) {
  if (side === 'staging') {
    if (row.pipeline_state === 'conflict') return 'conflict';
    if (row.pipeline_state === 'rejected') return 'QA rejected';
    if (row.pipeline_state === 'staging_queued') return 'awaiting merge';
    return row.jira_status;
  }
  if (row.pipeline_state === 'queued') return 'awaiting merge';
  return `merged ${formatTime(row.updated_at)}`;
}

function toBranchTicket(row, side) {
  return {
    key: row.ticket_key,
    summary: row.summary || null,
    statusLabel: statusLabelFor(row, side),
    pipelineState: row.pipeline_state,
  };
}

async function branchesForRepo({ repo, ticketsRepo, reposRepo, cutsRepo, github, repoResolver, log }) {
  const { owner, name, productionBranch, stagingBranch } = repo;

  // Fix PR-base drift before grouping (e.g. open PR retargeted to staging
  // while the ticket is still stuck as "awaiting production").
  const linked = ticketsRepo
    .list()
    .filter((t) => t.repo_owner === owner && t.repo_name === name && t.pr_number);
  await reconcileOpenPrBases(linked, { ticketsRepo, reposRepo, repoResolver, log });
  await reconcileMergeConflicts(linked, { ticketsRepo, reposRepo, repoResolver });

  const stagingSha = await github.getRef(stagingBranch).catch(() => null);

  const stagingRows = ['staging_queued', 'staging', 'conflict', 'rejected'].flatMap((s) =>
    ticketsRepo.listByPipelineStateAndRepo(s, owner, name)
  );
  const developRows = ['develop', 'queued'].flatMap((s) => ticketsRepo.listByPipelineStateAndRepo(s, owner, name));
  const cuts = await syncReleaseCutsFromGithub({
    github,
    cutsRepo,
    ticketsRepo,
    owner,
    name,
    stagingBranch,
  });
  const latestCut = cuts[0] || null;
  const productionHeadSha = latestCut?.sha || null;
  const productionHeadName = latestCut?.branchName || productionBranch;

  let commitsAheadOfProduction = null;
  let commitsAheadOfStaging = null;
  if (stagingSha && productionHeadSha) {
    const [aheadOfProduction, aheadOfStaging] = await Promise.all([
      github.listCommitsAhead(productionHeadName, stagingBranch).catch(() => null),
      github.listCommitsAhead(stagingBranch, productionHeadName).catch(() => null),
    ]);
    commitsAheadOfProduction = aheadOfProduction ? aheadOfProduction.length : null;
    commitsAheadOfStaging = aheadOfStaging ? aheadOfStaging.length : null;
  }

  return {
    repo: { owner, name, productionBranch: productionHeadName, stagingBranch },
    staging: {
      headSha: stagingSha,
      commitsAheadOfDevelop: commitsAheadOfProduction,
      tickets: stagingRows.map((r) => toBranchTicket(r, 'staging')),
    },
    develop: {
      headSha: productionHeadSha,
      commitsAheadOfStaging,
      tickets: developRows.map((r) => toBranchTicket(r, 'develop')),
    },
    cuts,
  };
}

function createBranchesRouter({ reposRepo, displayGithub, ticketsRepo, cutsRepo, repoResolver, logger }) {
  const router = express.Router();

  router.get('/branches', async (req, res, next) => {
    try {
      const activeRepos = reposRepo.list({ activeOnly: true });
      const results = await Promise.all(
        activeRepos.map((repo) =>
          branchesForRepo({
            repo,
            ticketsRepo,
            reposRepo,
            cutsRepo,
            github: displayGithub.getClient(repo.owner, repo.name),
            repoResolver,
            log: logger,
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

module.exports = { createBranchesRouter };
