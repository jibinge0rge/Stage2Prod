/** GitHub compare/commit objects include `parents: [{ sha }]`. */
function isMergeCommit(commit) {
  return Array.isArray(commit?.parents) && commit.parents.length > 1;
}

function countNonMergeCommits(commits) {
  if (!Array.isArray(commits)) return 0;
  return commits.filter((c) => !isMergeCommit(c)).length;
}

module.exports = { isMergeCommit, countNonMergeCommits };
