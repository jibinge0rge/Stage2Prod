const fetch = require('node-fetch');
const { logger } = require('../lib/logger');

const API_BASE = 'https://api.github.com';
const MAX_REPOS = 300; // 3 pages at 100/page — plenty for a personal/small-team token

// GitHub owner/org and repo names are restricted to alphanumerics, hyphens,
// underscores, and periods. Enforcing that here — before any value reaches
// a fetch() URL — closes off path/query injection into the upstream
// request (e.g. a repo "name" containing `/../` or `?` or extra `/`
// segments changing which GitHub endpoint actually gets hit).
const GITHUB_SEGMENT_RE = /^[A-Za-z0-9._-]{1,100}$/;

function assertValidSegment(value, label) {
  if (!GITHUB_SEGMENT_RE.test(value)) {
    const err = new Error(`invalid ${label}: "${value}"`);
    err.status = 400;
    throw err;
  }
}

/**
 * Account-level GitHub calls, not scoped to any one repo — used to power
 * the "connect a repository" picker (lists everything the token can see)
 * and to validate a repo exists/is reachable before watching it.
 */
async function listAccessibleRepos(token) {
  const repos = [];
  let page = 1;
  while (repos.length < MAX_REPOS) {
    const res = await fetch(
      `${API_BASE}/user/repos?affiliation=owner,collaborator,organization_member&per_page=100&page=${page}&sort=full_name`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      }
    );
    if (!res.ok) {
      const body = await res.text();
      logger.warn({ status: res.status, body }, 'failed to list accessible GitHub repos');
      const err = new Error(`GitHub GET /user/repos failed with ${res.status}`);
      err.status = res.status;
      throw err;
    }
    const batch = await res.json();
    repos.push(
      ...batch.map((r) => ({
        owner: r.owner.login,
        name: r.name,
        fullName: r.full_name,
        private: r.private,
        defaultBranch: r.default_branch,
      }))
    );
    if (batch.length < 100) break;
    page += 1;
  }
  return repos;
}

/**
 * Confirms a repo is reachable with the configured token, and reports its
 * actual default branch — used to pre-fill "production branch" when
 * connecting a repo, rather than guessing.
 */
async function getRepoInfo(token, owner, name) {
  assertValidSegment(owner, 'owner');
  assertValidSegment(name, 'repo name');
  const res = await fetch(`${API_BASE}/repos/${owner}/${name}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (res.status === 404) return { exists: false, defaultBranch: null };
  if (!res.ok) {
    const err = new Error(`GitHub GET /repos/${owner}/${name} failed with ${res.status}`);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  return { exists: true, defaultBranch: data.default_branch || null };
}

const MAX_BRANCHES = 300; // 3 pages at 100/page

/**
 * Lists branch names for a repo — used to populate the production/staging
 * branch pickers as dropdowns instead of free-text, both when connecting a
 * new repo and when editing an already-watched one's branch names.
 */
async function listBranchesForRepo(token, owner, name) {
  assertValidSegment(owner, 'owner');
  assertValidSegment(name, 'repo name');
  const branches = [];
  let page = 1;
  while (branches.length < MAX_BRANCHES) {
    const res = await fetch(`${API_BASE}/repos/${owner}/${name}/branches?per_page=100&page=${page}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (!res.ok) {
      const err = new Error(`GitHub GET /repos/${owner}/${name}/branches failed with ${res.status}`);
      err.status = res.status;
      throw err;
    }
    const batch = await res.json();
    branches.push(...batch.map((b) => b.name));
    if (batch.length < 100) break;
    page += 1;
  }
  return branches;
}

module.exports = { listAccessibleRepos, getRepoInfo, listBranchesForRepo };
