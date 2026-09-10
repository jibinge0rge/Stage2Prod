const fetch = require('node-fetch');
const { withRetry } = require('./httpRetry');
const { wrapWithDryRun } = require('../lib/dryRun');
const { logger } = require('../lib/logger');

const API_BASE = 'https://api.github.com';

class HttpError extends Error {
  constructor(status, message, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

const MUTATING_METHODS = ['createMerge', 'createPr', 'mergePr', 'closePr', 'deleteRef', 'updateRef', 'addLabel', 'createRef'];

class GitHubClient {
  /**
   * `sharedRateLimit`, when given, is a mutable object this client writes
   * into instead of its own — GitHub's rate limit is per-token, not
   * per-repo, so every client created for the same token (i.e. every repo
   * in the registry) should reflect one shared, most-recently-seen value
   * rather than each independently tracking only the requests it made.
   */
  constructor({ token, owner, repo, sharedRateLimit }) {
    this.token = token;
    this.owner = owner;
    this.repo = repo;
    this.rateLimit = sharedRateLimit || { remaining: null, limit: null, resetAt: null };
  }

  async _request(method, urlPath, body) {
    const url = `${API_BASE}${urlPath}`;
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const remaining = res.headers.get('x-ratelimit-remaining');
    const limit = res.headers.get('x-ratelimit-limit');
    const reset = res.headers.get('x-ratelimit-reset');
    if (remaining !== null) {
      // Mutate in place (not `this.rateLimit = {...}`) so a shared
      // rateLimit object — see the constructor — stays shared: replacing
      // the reference here would only update this one client's view.
      Object.assign(this.rateLimit, {
        remaining: Number(remaining),
        limit: Number(limit),
        resetAt: reset ? new Date(Number(reset) * 1000).toISOString() : null,
      });
    }

    let data = null;
    const text = await res.text();
    if (text) {
      try { data = JSON.parse(text); } catch { data = text; }
    }

    if (!res.ok) {
      const message = (data && data.message) || `GitHub ${method} ${urlPath} failed with ${res.status}`;
      logger.warn({ status: res.status, urlPath, method, message }, 'GitHub request failed');
      throw new HttpError(res.status, message, data);
    }
    return data;
  }

  _write(method, urlPath, body) {
    return withRetry(() => this._request(method, urlPath, body));
  }

  // ---- reads (never wrapped by dry-run) ----

  async listBranches() {
    const branches = [];
    let page = 1;
    // GitHub paginates at 30/page by default; 100 keeps calls low for typical repos.
    while (true) {
      const batch = await this._request('GET', `/repos/${this.owner}/${this.repo}/branches?per_page=100&page=${page}`);
      branches.push(...batch);
      if (batch.length < 100) break;
      page += 1;
    }
    return branches;
  }

  async listOpenPulls() {
    const pulls = [];
    let page = 1;
    while (true) {
      const batch = await this._request('GET', `/repos/${this.owner}/${this.repo}/pulls?state=open&per_page=100&page=${page}`);
      pulls.push(...batch);
      if (batch.length < 100) break;
      page += 1;
    }
    return pulls;
  }

  async getRef(branch) {
    const data = await this._request('GET', `/repos/${this.owner}/${this.repo}/git/ref/heads/${branch}`);
    return data.object.sha;
  }

  async getCombinedStatus(sha) {
    const [statusData, checkRuns] = await Promise.all([
      this._request('GET', `/repos/${this.owner}/${this.repo}/commits/${sha}/status`),
      this._request('GET', `/repos/${this.owner}/${this.repo}/commits/${sha}/check-runs`),
    ]);
    const combinedState = statusData.state; // success|pending|failure
    const checkRunsList = checkRuns.check_runs || [];
    const anyFailedCheck = checkRunsList.some((c) => c.conclusion === 'failure' || c.conclusion === 'cancelled' || c.conclusion === 'timed_out');
    const anyPendingCheck = checkRunsList.some((c) => c.status !== 'completed');
    let overall = 'passing';
    if (combinedState === 'failure' || anyFailedCheck) overall = 'failing';
    else if (combinedState === 'pending' || anyPendingCheck) overall = 'pending';
    return { overall, combinedState, checkRuns: checkRunsList };
  }

  async getPr(prNumber) {
    const data = await this._request('GET', `/repos/${this.owner}/${this.repo}/pulls/${prNumber}`);
    return {
      number: data.number,
      state: data.state, // 'open' | 'closed'
      mergeable: data.mergeable,
      mergeableState: data.mergeable_state,
      merged: data.merged,
      base: data.base.ref,
      head: data.head.ref,
      htmlUrl: data.html_url,
    };
  }

  async compareCommits(base, head) {
    const data = await this._request('GET', `/repos/${this.owner}/${this.repo}/compare/${base}...${head}`);
    return { aheadBy: data.ahead_by, behindBy: data.behind_by };
  }

  // The compare endpoint's own `commits` array *is* "everything ahead of
  // base" — using it instead of listing head's last N commits avoids
  // counting commits base and head both already share.
  async listCommitsAhead(base, head) {
    const data = await this._request('GET', `/repos/${this.owner}/${this.repo}/compare/${base}...${head}`);
    return data.commits || [];
  }

  // ---- writes (wrapped by dry-run in the factory below) ----

  async createMerge({ base, head, commitMessage }) {
    try {
      const data = await this._write('POST', `/repos/${this.owner}/${this.repo}/merges`, {
        base,
        head,
        commit_message: commitMessage,
      });
      if (data === null) return { conflict: false, alreadyUpToDate: true, sha: null };
      return { conflict: false, sha: data.sha };
    } catch (err) {
      if (err.status === 409) return { conflict: true, sha: null };
      throw err;
    }
  }

  async createPr({ base, head, title, body }) {
    const data = await this._write('POST', `/repos/${this.owner}/${this.repo}/pulls`, {
      base,
      head,
      title,
      body,
    });
    return { number: data.number, htmlUrl: data.html_url, headSha: data.head?.sha ?? null };
  }

  async mergePr(prNumber, { mergeMethod = 'merge' } = {}) {
    const data = await this._write('PUT', `/repos/${this.owner}/${this.repo}/pulls/${prNumber}/merge`, {
      merge_method: mergeMethod,
    });
    return { merged: data.merged, sha: data.sha };
  }

  async closePr(prNumber) {
    const data = await this._write('PATCH', `/repos/${this.owner}/${this.repo}/pulls/${prNumber}`, {
      state: 'closed',
    });
    return { number: data.number, state: data.state };
  }

  async deleteRef(branch) {
    try {
      await this._write('DELETE', `/repos/${this.owner}/${this.repo}/git/refs/heads/${branch}`);
      return { deleted: true };
    } catch (err) {
      if (err.status === 422 || err.status === 404) return { deleted: false, reason: 'already-gone' };
      throw err;
    }
  }

  async updateRef(branch, sha, { force = true } = {}) {
    const data = await this._write('PATCH', `/repos/${this.owner}/${this.repo}/git/refs/heads/${branch}`, {
      sha,
      force,
    });
    return { sha: data.object.sha };
  }

  async addLabel(prNumber, label) {
    await this._write('POST', `/repos/${this.owner}/${this.repo}/issues/${prNumber}/labels`, { labels: [label] });
    return { added: true };
  }

  async createRef(branch, sha) {
    const data = await this._write('POST', `/repos/${this.owner}/${this.repo}/git/refs`, {
      ref: `refs/heads/${branch}`,
      sha,
    });
    return { sha: data.object.sha };
  }
}

/**
 * Builds a client for one specific repo. `owner`/`repo` are explicit
 * (there's no single "the repo" anymore — Stage2Prod watches many), while
 * the token is shared config since one PAT covers every watched repo.
 */
function createGithubClient(config, { owner, repo, sharedRateLimit } = {}, dryRun = config.DRY_RUN) {
  const client = new GitHubClient({ token: config.GITHUB_TOKEN, owner, repo, sharedRateLimit });
  const synthetic = {
    createMerge: () => ({ conflict: false, sha: 'DRYRUN' }),
    createPr: () => ({ number: 0, htmlUrl: 'DRYRUN', headSha: 'DRYRUN' }),
    mergePr: () => ({ merged: true, sha: 'DRYRUN' }),
    closePr: () => ({ number: 0, state: 'closed' }),
    deleteRef: () => ({ deleted: true }),
    updateRef: () => ({ sha: 'DRYRUN' }),
    addLabel: () => ({ added: true }),
    createRef: () => ({ sha: 'DRYRUN' }),
  };
  return wrapWithDryRun(client, MUTATING_METHODS, synthetic, dryRun);
}

module.exports = { GitHubClient, createGithubClient, HttpError };
