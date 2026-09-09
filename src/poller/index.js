const { diffIssues, extractSprintName } = require('./diff');
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

  start() {
    this._stopped = false;
    this.logger.info({ intervalMs: this.config.POLL_INTERVAL_MS }, 'poller started');
    this._scheduleNext();
  }

  _scheduleNext() {
    if (this._stopped) return;
    this.nextPollAt = new Date(Date.now() + this.config.POLL_INTERVAL_MS).toISOString();
    this._timer = setTimeout(() => {
      this._currentTick = this._tick()
        .catch((err) => this.logger.error({ err: err.message }, 'poll tick failed unexpectedly'))
        .finally(() => {
          this._currentTick = null;
          this._scheduleNext();
        });
    }, this.config.POLL_INTERVAL_MS);
  }

  async _tick() {
    let ok = true;
    let errorMessage = null;
    try {
      const searchResult = await this.jira.search(this.config.JIRA_JQL);
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
          sprintName: extractSprintName(issue.fields.sprint),
          jiraUpdatedAt: issue.fields.updated,
        });
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
