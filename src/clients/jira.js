const fetch = require('node-fetch');
const { withRetry, sleep } = require('./httpRetry');
const { wrapWithDryRun } = require('../lib/dryRun');
const { logger } = require('../lib/logger');

class HttpError extends Error {
  constructor(status, message, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

const MUTATING_METHODS = ['addComment', 'transition'];

class JiraClient {
  constructor({ host, email, apiToken }) {
    this.host = host;
    this.email = email;
    this.apiToken = apiToken;
    this.rateLimit = { remaining: null, resetAt: null };
  }

  _authHeader() {
    const basic = Buffer.from(`${this.email}:${this.apiToken}`).toString('base64');
    return `Basic ${basic}`;
  }

  async _request(method, urlPath, body) {
    const url = `https://${this.host}${urlPath}`;
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: this._authHeader(),
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const remaining = res.headers.get('x-ratelimit-remaining');
    if (remaining !== null) {
      this.rateLimit = { remaining: Number(remaining), resetAt: null };
    }

    if (res.status === 429) {
      const retryAfter = res.headers.get('retry-after');
      const err = new HttpError(429, 'Jira rate limit exceeded', null);
      err.retryAfterMs = retryAfter ? Number(retryAfter) * 1000 : null;
      throw err;
    }

    let data = null;
    const text = await res.text();
    if (text) {
      try { data = JSON.parse(text); } catch { data = text; }
    }

    if (!res.ok) {
      const message = (data && (data.errorMessages || []).join('; ')) || `Jira ${method} ${urlPath} failed with ${res.status}`;
      logger.warn({ status: res.status, urlPath, method, message }, 'Jira request failed');
      throw new HttpError(res.status, message, data);
    }
    return data;
  }

  async _withJiraBackoff(fn) {
    return withRetry(fn, {
      retries: 5,
      isRetryable: (err) => err.status === 429,
      baseDelayMs: 1000,
      retryAfterMs: (err) => err.retryAfterMs ?? null,
    });
  }

  // ---- reads ----

  /**
   * `GET /rest/api/3/search` was removed by Atlassian (see
   * https://developer.atlassian.com/changelog/#CHANGE-2046) in favor of
   * `POST /rest/api/3/search/jql`, which also replaced offset-based
   * paging (`startAt`/`total`) with a cursor (`nextPageToken`/`isLast`).
   * Loops pages here so callers still get every matching issue back in
   * one `{ issues }` result, same as before.
   */
  /**
   * Jira Software stores Sprint as a custom field (`gh-sprint`), not a
   * built-in named `sprint`. Discover that field id once per process so
   * search actually returns it.
   */
  async getSprintFieldIds() {
    if (this._sprintFieldIds) return this._sprintFieldIds;
    try {
      const fields = await this._withJiraBackoff(() => this._request('GET', '/rest/api/3/field'));
      this._sprintFieldIds = (fields || [])
        .filter((f) => f.schema?.custom === 'com.pyxis.greenhopper.jira:gh-sprint' || /^sprint$/i.test(f.name || ''))
        .map((f) => f.id)
        .filter(Boolean);
    } catch (err) {
      logger.warn({ err: err.message }, 'could not list Jira fields to find Sprint');
      this._sprintFieldIds = [];
    }
    if (this._sprintFieldIds.length === 0) this._sprintFieldIds = ['sprint'];
    return this._sprintFieldIds;
  }

  async search(jql) {
    const sprintFields = await this.getSprintFieldIds();
    const issues = [];
    let nextPageToken;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const body = {
        jql,
        fields: ['summary', 'status', 'assignee', 'updated', 'closedSprints', ...sprintFields],
        maxResults: 100,
        ...(nextPageToken ? { nextPageToken } : {}),
      };
      // eslint-disable-next-line no-await-in-loop
      const data = await this._withJiraBackoff(() => this._request('POST', '/rest/api/3/search/jql', body));
      issues.push(...(data.issues || []));
      if (data.isLast !== false || !data.nextPageToken) break;
      nextPageToken = data.nextPageToken;
    }
    return { issues };
  }

  async getTransitions(ticketKey) {
    const data = await this._withJiraBackoff(() => this._request('GET', `/rest/api/3/issue/${ticketKey}/transitions`));
    return data.transitions || [];
  }

  // ---- writes ----

  async addComment(ticketKey, text) {
    await this._withJiraBackoff(() =>
      this._request('POST', `/rest/api/3/issue/${ticketKey}/comment`, {
        body: {
          type: 'doc',
          version: 1,
          content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
        },
      })
    );
    return { commented: true };
  }

  async transition(ticketKey, transitionName) {
    const transitions = await this.getTransitions(ticketKey);
    const match =
      transitions.find((t) => t.name === transitionName) ||
      transitions.find((t) => t.to?.name === transitionName);
    if (!match) return { transitioned: false, reason: 'transition-not-available' };
    await this._withJiraBackoff(() =>
      this._request('POST', `/rest/api/3/issue/${ticketKey}/transitions`, { transition: { id: match.id } })
    );
    return { transitioned: true };
  }

  async tryTransition(ticketKey, transitionName) {
    try {
      return await this.transition(ticketKey, transitionName);
    } catch (err) {
      logger.warn({ ticketKey, transitionName, err: err.message }, 'best-effort transition failed, ignoring');
      return { transitioned: false, reason: 'error', error: err.message };
    }
  }
}

function createJiraClient(config, dryRun = config.DRY_RUN) {
  const client = new JiraClient({ host: config.JIRA_HOST, email: config.JIRA_EMAIL, apiToken: config.JIRA_API_TOKEN });
  const synthetic = {
    addComment: () => ({ commented: true }),
    transition: () => ({ transitioned: true }),
  };
  return wrapWithDryRun(client, MUTATING_METHODS, synthetic, dryRun);
}

module.exports = { JiraClient, createJiraClient, HttpError, sleep };
