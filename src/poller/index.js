const { diffIssues, sprintNameFromIssue } = require('./diff');
const { buildPollJql } = require('./jql');
const { dispatch } = require('../handlers');
const { newCorrelationId } = require('../lib/correlationId');
const { OUTCOMES } = require('../lib/constants');

class Poller {
  constructor({ jira, repoResolver, reposRepo, config, ticketsRepo, eventsRepo, cursorRepo, lockManager, logger }) {
    this.jira = jira;
    this.repoResolver = repoResolver;
    this.reposRepo = reposRepo;
    this.config = config;
    this.ticketsRepo = ticketsRepo;
    this.eventsRepo = eventsRepo;
    this.cursorRepo = cursorRepo;
    this.lockManager = lockManager;
    this.logger = logger;
    this._timer = null;
    this._stopped = true;
    this._currentTick = null;
    this.nextPollAt = null;
  }

  isRunning() {
    return !this._stopped;
  }

  /**
   * Runs a tick immediately, outside the regular interval — used after a
   * manual Jira transition from the UI, and by POST /api/sync ("Sync now"),
   * so the dashboard does not wait up to POLL_INTERVAL_MS. Joins an
   * already-in-flight tick rather than starting a second overlapping one.
   */
  async pollNow() {
    return this._runTick({ reschedule: false });
  }

  start() {
    this._stopped = false;
    this.logger.info({ intervalMs: this.config.POLL_INTERVAL_MS }, 'poller started');
    this._scheduleNext();
  }

  _runTick({ reschedule }) {
    if (this._currentTick) {
      if (reschedule) return this._currentTick.finally(() => this._scheduleNext());
      return this._currentTick;
    }
    this._currentTick = this._tick()
      .catch((err) => this.logger.error({ err: err.message }, 'poll tick failed unexpectedly'))
      .finally(() => {
        this._currentTick = null;
        if (reschedule && !this._stopped) this._scheduleNext();
      });
    return this._currentTick;
  }

  _scheduleNext() {
    if (this._stopped) return;
    this.nextPollAt = new Date(Date.now() + this.config.POLL_INTERVAL_MS).toISOString();
    this._timer = setTimeout(() => {
      this._runTick({ reschedule: true });
    }, this.config.POLL_INTERVAL_MS);
  }

  async _tick() {
    let ok = true;
    let errorMessage = null;
    try {
      const jql = buildPollJql(this.reposRepo.list({ activeOnly: true }), this.config);
      const searchResult = await this.jira.search(jql);
      const issues = searchResult.issues || [];
      this.repoResolver.invalidateAll();

      for (const issue of issues) {
        this.ticketsRepo.upsert({
          key: issue.key,
          summary: issue.fields.summary,
          jiraStatus: issue.fields.status.name,
          lastSeenStatus: this.ticketsRepo.getLastSeenStatus(issue.key) ?? issue.fields.status.name,
          assigneeName: issue.fields.assignee ? issue.fields.assignee.displayName : null,
          assigneeAvatarUrl: issue.fields.assignee ? issue.fields.assignee.avatarUrls?.['48x48'] : null,
          sprintName: sprintNameFromIssue(issue),
          jiraUpdatedAt: issue.fields.updated,
        });

        // Tag the ticket with its repo as soon as it's ever seen — not
        // only once a status transition gets processed — whenever its
        // Jira project key unambiguously maps to exactly one watched
        // repo. Cheap (DB-only, no GitHub calls), so safe to do for every
        // ticket on every tick, including ones with no mapped handler.
        const row = this.ticketsRepo.get(issue.key);
        if (!row.repo_owner) {
          const match = this.repoResolver.matchByProjectKeyOnly(issue.key);
          if (match) this.ticketsRepo.setRepo(issue.key, match.owner, match.name);
        }
      }

      const events = diffIssues(issues, (key) => this.ticketsRepo.getLastSeenStatus(key));
      for (const event of events) {
        // eslint-disable-next-line no-await-in-loop
        await this._processOne(event);
      }

      if (events.length) {
        const newestHandled = events[events.length - 1].jiraUpdatedAt;
        this.cursorRepo.setCursor(newestHandled);
      }

      if (this.jira.rateLimit) {
        this.cursorRepo.setJiraRateLimit({
          remaining: this.jira.rateLimit.remaining,
          resetAt: this.jira.rateLimit.resetAt,
        });
      }
    } catch (err) {
      ok = false;
      errorMessage = err.message;
      this.logger.error({ err: err.message }, 'poll failed');
    }
    this.cursorRepo.recordPoll({ ok, error: errorMessage });
  }

  async _processOne(event) {
    const correlationId = newCorrelationId();
    const log = this.logger.child({ correlationId, ticketKey: event.ticketKey });
    const handler = dispatch(event.newStatus);

    if (!handler) {
      log.info({ status: event.newStatus }, 'status change has no mapped handler, recording only');
      this.ticketsRepo.setLastSeenStatus(event.ticketKey, event.newStatus);
      return;
    }

    try {
      const ticketRow = this.ticketsRepo.get(event.ticketKey);
      const knownRepo = ticketRow?.repo_owner ? { owner: ticketRow.repo_owner, name: ticketRow.repo_name } : null;
      const resolution = await this.repoResolver.resolveTicket(event.ticketKey, knownRepo);

      if (!resolution.found) {
        const detail = resolution.ambiguous
          ? `Matched a branch/PR in more than one watched repo (${resolution.candidates
              .map((c) => `${c.owner}/${c.name}`)
              .join(', ')}) — resolve manually by making the branch name unique or unwatching one of the repos.`
          : `No branch or open PR containing "${event.ticketKey}" was found in any watched repo.`;
        this.eventsRepo.insertEvent({
          ticketKey: event.ticketKey,
          trigger: 'Poll · status change',
          action: 'resolve-repo',
          outcome: OUTCOMES.NOTED,
          title: resolution.ambiguous ? 'Ambiguous repo match' : 'No matching repo found',
          detail,
          correlationId,
        });
        log.warn({ ambiguous: !!resolution.ambiguous }, 'could not resolve ticket to a single watched repo');
        this.ticketsRepo.setLastSeenStatus(event.ticketKey, event.newStatus);
        return;
      }

      const { owner: repoOwner, name: repoName } = resolution;
      this.ticketsRepo.setRepo(event.ticketKey, repoOwner, repoName);
      const repoConfig = this.reposRepo.get(repoOwner, repoName);

      await handler({
        event,
        log,
        correlationId,
        repoOwner,
        repoName,
        productionBranch: repoConfig.productionBranch,
        stagingBranch: repoConfig.stagingBranch,
        github: this.repoResolver.getClient(repoOwner, repoName),
        jira: this.jira,
        ticketsRepo: this.ticketsRepo,
        eventsRepo: this.eventsRepo,
        lockManager: this.lockManager,
        ticketMatcher: this.repoResolver.getMatcher(repoOwner, repoName),
      });
    } catch (err) {
      log.error({ err: err.message }, 'handler failed');
      this.eventsRepo.insertEvent({
        ticketKey: event.ticketKey,
        trigger: 'Poll · status change',
        action: 'error',
        outcome: OUTCOMES.NOTED,
        title: 'Handler failed',
        detail: err.message,
        correlationId,
      });
    }
    // Last-seen status advances even on failure so a permanently-broken
    // transition doesn't retry forever; failures stay visible via
    // /api/events and are manually retryable from the ticket drawer.
    this.ticketsRepo.setLastSeenStatus(event.ticketKey, event.newStatus);
  }

  async stop() {
    this._stopped = true;
    if (this._timer) clearTimeout(this._timer);
    if (this._currentTick) {
      await Promise.race([
        this._currentTick,
        new Promise((resolve) => setTimeout(resolve, 25000)),
      ]);
    }
    this.logger.info('poller stopped');
  }
}

module.exports = { Poller };
