const express = require('express');
const { countNonMergeCommits } = require('../lib/gitCommit');

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
      github.listCommitsAhead(productionBranch, stagingBranch).catch(() => null),
      github.listCommitsAhead(stagingBranch, productionBranch).catch(() => null),
    ]);
    // Merge commits are PR plumbing (Stage2Prod always uses merge-commit,
    // not squash) — they are not extra unvalidated work.
    commitsAheadOfProduction = aheadOfProduction ? countNonMergeCommits(aheadOfProduction) : null;
    commitsAheadOfStaging = aheadOfStaging ? countNonMergeCommits(aheadOfStaging) : null;
  }

  const stagingRows = ['staging_queued', 'staging', 'conflict', 'rejected'].flatMap((s) =>
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
