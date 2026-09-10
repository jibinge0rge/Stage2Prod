const { isMergeCommit } = require('../lib/gitCommit');

/**
 * Finds GitHub activity in a watched repo that Stage2Prod's Jira-driven
 * workflow has no ticket for: open PRs targeting the staging branch, open
 * PRs targeting the production branch, and commits sitting on staging
 * ahead of production — whose name/title/message doesn't contain any
 * currently-tracked ticket key. This is visibility only: nothing here is
 * acted on automatically, since without a ticket key there's no status
 * transition to drive a merge off of.
 */
function matchesAnyTicket(text, ticketKeys) {
  if (!text) return false;
  return ticketKeys.some((key) => text.includes(key));
}

function parentShas(commit) {
  return (commit.parents || []).map((p) => p.sha).filter(Boolean);
}

function messageOf(commit) {
  return commit.commit ? commit.commit.message : '';
}

/**
 * Feature commits of a "Merge pull request" often have messages like
 * "wip" with no ticket key. The merge commit itself usually names the
 * branch (`Merge pull request #12 from org/feat/PROJ-1-login`). Treat
 * those incoming-branch commits as tracked so Overview doesn't flag
 * the merge plumbing as "without a ticket".
 */
function shasCoveredByTicketMerges(commits, ticketKeys) {
  const covered = new Set();
  const inWindow = new Set(commits.map((c) => c.sha));

  for (const c of commits) {
    if (!isMergeCommit(c) || !matchesAnyTicket(messageOf(c), ticketKeys)) continue;
    for (const sha of parentShas(c).slice(1)) covered.add(sha);
  }

  let grew = true;
  while (grew) {
    grew = false;
    for (const c of commits) {
      if (!covered.has(c.sha)) continue;
      for (const sha of parentShas(c)) {
        if (inWindow.has(sha) && !covered.has(sha)) {
          covered.add(sha);
          grew = true;
        }
      }
    }
  }
  return covered;
}

function toUntrackedPr(pr) {
  return {
    number: pr.number,
    title: pr.title,
    headRef: pr.head.ref,
    baseRef: pr.base.ref,
    author: pr.user ? pr.user.login : null,
    url: pr.html_url,
    createdAt: pr.created_at,
  };
}

function toUntrackedCommit(c) {
  return {
    sha: c.sha,
    message: ((c.commit && c.commit.message) || '').split('\n')[0],
    author: (c.commit && c.commit.author && c.commit.author.name) || (c.author && c.author.login) || null,
    date: c.commit && c.commit.author ? c.commit.author.date : null,
    url: c.html_url,
  };
}

async function untrackedForRepo({ repo, github, ticketKeys }) {
  const { owner, name, productionBranch, stagingBranch } = repo;

  // Caught per-call (not just per-repo) so one repo's GitHub hiccup (rate
  // limit, revoked access) doesn't blank out every other watched repo's
  // untracked view too — matches how /api/branches degrades.
  const [pulls, stagingAheadCommits] = await Promise.all([
    github.listOpenPulls().catch(() => []),
    github.listCommitsAhead(productionBranch, stagingBranch).catch(() => []),
  ]);

  const untrackedPulls = pulls.filter(
    (pr) => !matchesAnyTicket(pr.head.ref, ticketKeys) && !matchesAnyTicket(pr.title, ticketKeys)
  );

  const pullRequestsToStaging = untrackedPulls.filter((pr) => pr.base.ref === stagingBranch).map(toUntrackedPr);
  const pullRequestsToProduction = untrackedPulls.filter((pr) => pr.base.ref === productionBranch).map(toUntrackedPr);

  // Ahead-of-production only (not "last 20 on staging") so a commit
  // production and staging both already share is never double-counted.
  const coveredByTicketMerge = shasCoveredByTicketMerges(stagingAheadCommits, ticketKeys);
  const untrackedStagingCommits = stagingAheadCommits
    .filter((c) => !isMergeCommit(c))
    .filter((c) => !coveredByTicketMerge.has(c.sha))
    .filter((c) => !matchesAnyTicket(messageOf(c), ticketKeys))
    .map(toUntrackedCommit);

  return {
    repo: { owner, name, productionBranch, stagingBranch },
    pullRequestsToStaging,
    pullRequestsToProduction,
    stagingCommits: untrackedStagingCommits,
  };
}

module.exports = { untrackedForRepo };
