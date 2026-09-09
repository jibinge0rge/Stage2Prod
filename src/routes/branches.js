const express = require('express');

function formatTime(iso) {
  if (!iso) return '';
  return new Date(iso).toISOString().slice(11, 16);
}

function statusLabelFor(row, side) {
  if (side === 'staging') {
    if (row.pipeline_state === 'conflict') return 'conflict';
    if (row.pipeline_state === 'rejected') return 'QA rejected';
    return row.jira_status;
  }
  if (row.pipeline_state === 'queued') return 'awaiting merge';
  return `merged ${formatTime(row.updated_at)}`;
}

async function branchesForRepo({ repo, ticketsRepo, github }) {
  const { owner, name, productionBranch, stagingBranch } = repo;
  const [stagingSha, productionSha] = await Promise.all([
    github.getRef(stagingBranch).catch(() => null),
    github.getRef(productionBranch).catch(() => null),
  ]);

  let commitsAheadOfProduction = null;
  let commitsAheadOfStaging = null;
  if (stagingSha && productionSha) {
    const [aheadOfProduction, aheadOfStaging] = await Promise.all([
      github.compareCommits(productionBranch, stagingBranch).catch(() => null),
      github.compareCommits(stagingBranch, productionBranch).catch(() => null),
    ]);
    commitsAheadOfProduction = aheadOfProduction ? aheadOfProduction.aheadBy : null;
    commitsAheadOfStaging = aheadOfStaging ? aheadOfStaging.aheadBy : null;
  }

  const stagingRows = ['staging', 'conflict', 'rejected'].flatMap((s) =>
    ticketsRepo.listByPipelineStateAndRepo(s, owner, name)
  );
  const developRows = ['develop', 'queued'].flatMap((s) => ticketsRepo.listByPipelineStateAndRepo(s, owner, name));

  return {
    repo: { owner, name, productionBranch, stagingBranch },
    staging: {
      headSha: stagingSha,
      commitsAheadOfDevelop: commitsAheadOfProduction,
      tickets: stagingRows.map((r) => ({ key: r.ticket_key, statusLabel: statusLabelFor(r, 'staging'), pipelineState: r.pipeline_state })),
    },
    develop: {
      headSha: productionSha,
      commitsAheadOfStaging,
      tickets: developRows.map((r) => ({ key: r.ticket_key, statusLabel: statusLabelFor(r, 'develop'), pipelineState: r.pipeline_state })),
    },
  };
}

function createBranchesRouter({ reposRepo, displayGithub, ticketsRepo }) {
  const router = express.Router();

  router.get('/branches', async (req, res, next) => {
    try {
      const activeRepos = reposRepo.list({ activeOnly: true });
      const results = await Promise.all(
        activeRepos.map((repo) =>
          branchesForRepo({
            repo,
            ticketsRepo,
            github: displayGithub.getClient(repo.owner, repo.name),
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
