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
      const jql = buildPollJql(await this.reposRepo.list({ activeOnly: true }), this.config);
      const searchResult = await this.jira.search(jql);
      const issues = searchResult.issues || [];
      this.repoResolver.invalidateAll();

      for (const issue of issues) {
        // eslint-disable-next-line no-await-in-loop
        await this.ticketsRepo.upsert({
          key: issue.key,
          summary: issue.fields.summary,
          jiraStatus: issue.fields.status.name,
          lastSeenStatus: (await this.ticketsRepo.getLastSeenStatus(issue.key)) ?? issue.fields.status.name,
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
        // eslint-disable-next-line no-await-in-loop
        const row = await this.ticketsRepo.get(issue.key);
        if (!row.repo_owner) {
          const match = await this.repoResolver.matchByProjectKeyOnly(issue.key);
          if (match) await this.ticketsRepo.setRepo(issue.key, match.owner, match.name);
        }
      }

      // Reflects last_seen_status as stored after the upsert loop above
      // (unchanged for existing tickets, backfilled to the current status
      // for brand-new ones) — fetched in bulk up front so diffIssues can
      // stay a pure, synchronous lookup.
      const lastSeenEntries = await Promise.all(
        issues.map(async (issue) => [issue.key, await this.ticketsRepo.getLastSeenStatus(issue.key)])
      );
      const lastSeenByKey = new Map(lastSeenEntries);
      const events = diffIssues(issues, (key) => lastSeenByKey.get(key));
      for (const event of events) {
        // eslint-disable-next-line no-await-in-loop
        await this._processOne(event);
      }

      if (events.length) {
        const newestHandled = events[events.length - 1].jiraUpdatedAt;
        await this.cursorRepo.setCursor(newestHandled);
      }

      if (this.jira.rateLimit) {
        await this.cursorRepo.setJiraRateLimit({
          remaining: this.jira.rateLimit.remaining,
          resetAt: this.jira.rateLimit.resetAt,
        });
      }
    } catch (err) {
      ok = false;
      errorMessage = err.message;
      this.logger.error({ err: err.message }, 'poll failed');
    }
    await this.cursorRepo.recordPoll({ ok, error: errorMessage });
  }

  async _processOne(event) {
    const correlationId = newCorrelationId();
    const log = this.logger.child({ correlationId, ticketKey: event.ticketKey });

    // Prefer the ticket's known repo, then the Jira project key → watched
    // repo mapping, so each project can use its own status→action map.
    const ticketRow = await this.ticketsRepo.get(event.ticketKey);
    let mapSource = null;
    if (ticketRow?.repo_owner) {
      mapSource = await this.reposRepo.get(ticketRow.repo_owner, ticketRow.repo_name);
    }
    if (!mapSource) {
      const byProject = await this.repoResolver.matchByProjectKeyOnly(event.ticketKey);
      if (byProject) mapSource = await this.reposRepo.get(byProject.owner, byProject.name);
    }

    const handler = dispatch(event.newStatus, mapSource?.effectiveStatusHandlerMap || mapSource?.statusHandlerMap);

    if (!handler) {
      log.info({ status: event.newStatus }, 'status change has no mapped handler, recording only');
      await this.ticketsRepo.setLastSeenStatus(event.ticketKey, event.newStatus);
      return;
    }

    try {
      const knownRepo = ticketRow?.repo_owner ? { owner: ticketRow.repo_owner, name: ticketRow.repo_name } : null;
      const resolution = await this.repoResolver.resolveTicket(event.ticketKey, knownRepo);

      if (!resolution.found) {
        const detail = resolution.ambiguous
          ? `Matched a branch/PR in more than one watched repo (${resolution.candidates
              .map((c) => `${c.owner}/${c.name}`)
              .join(', ')}) — resolve manually by making the branch name unique or unwatching one of the repos.`
          : `No branch or open PR containing "${event.ticketKey}" was found in any watched repo.`;
        await this.eventsRepo.insertEvent({
          ticketKey: event.ticketKey,
          trigger: 'Poll · status change',
          action: 'resolve-repo',
          outcome: OUTCOMES.NOTED,
          title: resolution.ambiguous ? 'Ambiguous repo match' : 'No matching repo found',
          detail,
          correlationId,
        });
        log.warn({ ambiguous: !!resolution.ambiguous }, 'could not resolve ticket to a single watched repo');
        await this.ticketsRepo.setLastSeenStatus(event.ticketKey, event.newStatus);
        return;
      }

      const { owner: repoOwner, name: repoName } = resolution;
      await this.ticketsRepo.setRepo(event.ticketKey, repoOwner, repoName);
      const repoConfig = await this.reposRepo.get(repoOwner, repoName);

      await handler({
        event,
        log,
        correlationId,
        repoOwner,
        repoName,
        productionBranch: repoConfig.productionBranch,
        stagingBranch: repoConfig.stagingBranch,
        statusMap: repoConfig.effectiveStatusHandlerMap || repoConfig.statusHandlerMap,
        teamRoles: repoConfig.teamRoles,
        github: this.repoResolver.getClient(repoOwner, repoName),
        jira: this.jira,
        ticketsRepo: this.ticketsRepo,
        eventsRepo: this.eventsRepo,
        lockManager: this.lockManager,
        ticketMatcher: this.repoResolver.getMatcher(repoOwner, repoName),
      });
    } catch (err) {
      log.error({ err: err.message }, 'handler failed');
      await this.eventsRepo.insertEvent({
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
    await this.ticketsRepo.setLastSeenStatus(event.ticketKey, event.newStatus);
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
