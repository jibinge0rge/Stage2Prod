const { isMergeCommit, countNonMergeCommits } = require('../../src/lib/gitCommit');

describe('gitCommit', () => {
  it('treats a commit with two parents as a merge', () => {
    expect(isMergeCommit({ parents: [{ sha: 'a' }, { sha: 'b' }] })).toBe(true);
    expect(isMergeCommit({ parents: [{ sha: 'a' }] })).toBe(false);
    expect(isMergeCommit({ sha: 'x' })).toBe(false);
  });

  it('counts only non-merge commits', () => {
    const commits = [
      { sha: 'feat', parents: [{ sha: 'prod' }] },
      { sha: 'merge', parents: [{ sha: 'prod' }, { sha: 'feat' }] },
    ];
    expect(countNonMergeCommits(commits)).toBe(1);
    expect(countNonMergeCommits(null)).toBe(0);
  });
});
