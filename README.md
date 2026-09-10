# Stage2Prod

A locally-run Jira ↔ GitHub release orchestrator. It polls Jira Cloud for ticket status transitions and opens
the right pull request accordingly — never cherry-picking, never reverting, never squashing, and **never
merging on its own**: merging staging or production is always a deliberate action a person takes from the
Stage2Prod dashboard (or Jira status transitions/comments, also doable from the dashboard — see **Ticket
actions** below).

- `develop` — long-lived, validated production-ready code.
- `staging` — long-lived but ephemeral in content; a QA test bed that can be wiped at any time.
- Feature branches are named after Jira ticket keys (`feat/PROJ-101-description` or `PROJ-101-auth`).

| Jira status | Automatic | Requires a human click |
|---|---|---|
| Ready for QA / In QA | Opens a PR: feature branch → `staging` | **Merge** button → merges the PR |
| Approved / Ready for Release / Done | Opens a PR: feature branch → `develop` | **Merge** button → merges (merge commit), deletes remote branch |
| In Development / QA Failed | No git action — comment on Jira, label PR `qa-rejected` | — |

## Ticket actions

The ticket drawer (click any ticket on **Ticket pipeline**) lets you act on a ticket without leaving the
dashboard:
- **Transition Jira status** — a dropdown of that ticket's real available Jira transitions
  (`GET /api/tickets/:key/transitions`); picking one calls Jira immediately, then triggers an out-of-cycle
  poll (`Poller.pollNow()`) so its effect (e.g. a PR opening) shows up right away instead of waiting for the
  next scheduled poll.
- **Comment on Jira** — posts a plain comment to the ticket.
- **Merge** — appears once a PR is open and awaiting merge (pipeline state `staging_queued`/`queued`), *or*
  a previous attempt left the ticket in `conflict` (retryable, in case the PR was fixed on GitHub since).
  This is the only thing in the whole app that writes to `staging` or `develop`. Before merging, it checks
  the PR's live GitHub state and reacts differently depending on why it's not mergeable: a PR that's still
  open but genuinely conflicting flips the ticket to `conflict` with a retry option; a PR that's been closed
  or no longer exists (e.g. its branch was deleted) instead **clears the ticket back to `unmerged`** — since
  retrying would never help there, it just waits for its next real Jira transition to open a fresh PR, rather
  than sitting stuck. Either way the real reason is recorded on the event and shown in the drawer, not a
  generic "conflict" message.

Ticket Pipeline itself shows every currently-open ticket in your configured Jira project(s), not just ones
that recently changed status — see **Choosing the JQL**.

## Project layout

```
src/            Express backend (poller, handlers, routes, SQLite persistence)
tests/          Vitest suite — handlers, mutex, clients, routes (Jira/GitHub mocked)
web/            React dashboard (Vite)
data/           SQLite database file (gitignored)
```

## Setup

### 1. Backend

```bash
npm install
cp .env.example .env
```

Fill in `.env`:

| Var | Notes |
|---|---|
| `GITHUB_TOKEN` | A GitHub PAT (classic or fine-grained) with `repo` scope, covering every repo you'll watch. |
| `JIRA_HOST` | e.g. `your-domain.atlassian.net` |
| `JIRA_EMAIL` / `JIRA_API_TOKEN` | See **Creating a Jira API token** below. |
| `JIRA_JQL` | Fallback JQL, used only until any watched repo has a Jira project key configured — see **Choosing the JQL** below. |
| `JIRA_POLL_CLAUSE` | The non-project part of the auto-built JQL once repos have project keys (default `(statusCategory != Done OR updated >= -15m)` — the full open backlog, plus a window so a just-completed transition is still caught — see **Choosing the JQL**). |
| `API_TOKEN` | Bearer token required to call `POST /api/staging/reset` / `POST /api/repos` / `DELETE /api/repos/...`. Any local secret string. |
| `DRY_RUN` | `true` to log intended git/Jira writes without performing them — safe for trying the UI out. |

Note there's no `GITHUB_OWNER`/`GITHUB_REPO` — Stage2Prod watches however many repos you connect at runtime
(see **Watching repositories** below), not one fixed repo baked into `.env`.

Start the API:

```bash
npm run dev:api      # nodemon, port 3000
# or: npm start       # no auto-restart
```

Optional: seed the database with demo data (mockup-shaped sample tickets/events, plus one demo watched repo)
so the dashboard has something to show before you've connected real Jira/GitHub credentials:

```bash
npm run seed
```

### 2. Frontend

```bash
cd web
npm install
cp .env.example .env   # VITE_API_TOKEN must match the backend's API_TOKEN
npm run dev            # Vite, port 5173, proxies /api to :3000
```

Open `http://localhost:5173`.

### 3. Both at once

From the repo root, `npm run dev` runs the API and the web dev server together (via `concurrently`).

### Production build

```bash
npm run build:web   # builds web/dist
npm start            # Express serves web/dist as static files + the API, single port
```

## Watching repositories

Stage2Prod watches however many GitHub repos you connect — nothing is fixed in `.env`. From the **Repositories**
page in the UI: **Connect a repository** lists every repo `GITHUB_TOKEN` can see (personal and org repos it
has access to), pick one to start watching it. **Stop watching** removes it from active polling/matching but
keeps its historical tickets and events for the record (a soft removal, not a delete).

The same thing works directly against the API if you're scripting setup:

```bash
curl -X POST http://localhost:3000/api/repos \
  -H "Authorization: Bearer $API_TOKEN" -H "Content-Type: application/json" \
  -d '{"owner":"your-org","name":"your-repo"}'
```

Each watched repo can also be given a **Jira project key** (editable from the same Repositories page, or via
`jiraProjectKey` in the `POST`/`PATCH` body) — the part of a ticket key before the hyphen, e.g. `PROJ` for
`PROJ-101`. This is what actually resolves a ticket to a repo: if exactly one watched repo claims a ticket's
project, that's its repo, no GitHub calls needed. If more than one repo shares a project key (e.g. a monorepo
split across two GitHub repos), or no repo has claimed it yet, Stage2Prod falls back to searching branches/open
PRs — narrowed to just the repos sharing that project key when there are any, otherwise every watched repo —
and remembers whichever repo actually matched from then on. If that search still matches more than one repo,
Stage2Prod does **not** guess — it logs an `ambiguous repo match` event and takes no git action until you
rename the branch to be unique, set distinguishing Jira project keys, or stop watching one of the repos.

A repo with no Jira project key configured shows a **no Jira project** warning on the Repositories page —
its tickets won't be included in what the poller fetches from Jira at all (see **Choosing the JQL** below).

## Untracked changes

Stage2Prod only ever reasons about the Jira tickets it's tracking — anything else happening in a watched
repo (an ad-hoc PR, a direct merge to staging) is otherwise invisible. The **Untracked changes** page lists,
per watched repo: open pull requests targeting the staging branch, open pull requests targeting the
production branch, and commits sitting on staging ahead of production — whichever of those don't reference
any ticket key Stage2Prod currently knows about. It's visibility only — nothing shown here is merged,
deleted, or otherwise acted on automatically. Backed by `GET /api/untracked[?repo=owner/name]`.

## Docker

The `Dockerfile` is a multi-stage build: it builds the frontend, installs backend dependencies (with the
build tools `better-sqlite3` needs), then assembles a slim runtime image containing only `node_modules`,
`src`, and the built `web/dist` — the same single-port "Express serves the SPA + the API" mode as
`npm start`. It runs as a non-root user and declares `/app/data` as a volume for the SQLite file.

```bash
docker compose up --build
```

This reads `.env` from the repo root (`env_file: .env` in `docker-compose.yml`) and persists the database in
a named volume (`stage2prod-data`) so it survives container restarts and rebuilds. The app is then at
`http://localhost:3000`.

Without compose:

```bash
docker build -t stage2prod .
docker run -d --name stage2prod \
  -p 3000:3000 \
  --env-file .env \
  -v stage2prod-data:/app/data \
  stage2prod
```

Notes:
- `DB_PATH` inside the container defaults to `/app/data/stage2prod.db` (set in `docker-compose.yml`) — keep
  it under `/app/data` so it lands on the volume, or it's lost on the next `docker compose down -v` / rebuild.
- Secrets (`GITHUB_TOKEN`, `JIRA_API_TOKEN`, `API_TOKEN`) come from `.env` at *run* time via `--env-file` /
  `env_file`, never baked into the image.
- `HEALTHCHECK` in the Dockerfile hits `GET /api/health`, so `docker ps` / `docker compose ps` reflect real
  service health, not just "the process is alive."
- To ship the built frontend for a different backend URL, the SPA calls `/api/*` as a relative path, so it
  works behind any reverse proxy in front of the container without a rebuild.

## Creating a Jira API token

1. Log in as the account Stage2Prod will act as (a dedicated automation/bot account is recommended).
2. Go to `https://id.atlassian.com/manage-profile/security/api-tokens`.
3. **Create API token**, name it (e.g. `stage2prod`), copy the value into `JIRA_API_TOKEN`.
4. Set `JIRA_EMAIL` to that account's Atlassian email. The poller authenticates with HTTP Basic auth
   (`email:token`) — this is the standard way to call Jira Cloud's REST API as a script/bot.

## Choosing the JQL

The poller runs `POST /rest/api/3/search/jql` every `POLL_INTERVAL_MS` (default 60000), paginating via
`nextPageToken` if a poll matches more than 100 issues. The JQL itself is built one of two ways
(`src/poller/jql.js`), visible at any time via `GET /api/health`'s `jiraJql` field or the **Rules & polling**
page:

- **No watched repo has a Jira project key yet** — `JIRA_JQL` is used verbatim (the single-project default:
  `project = PROJ AND (statusCategory != Done OR updated >= -15m) ORDER BY updated ASC`). This is what a
  fresh install runs before you've configured any repo's Jira project.
- **At least one watched repo has a Jira project key** — the poller instead builds
  `project in ("KEY1", "KEY2", ...) AND {JIRA_POLL_CLAUSE} ORDER BY updated ASC` from the union of every
  watched repo's configured project key. A repo with no project key configured contributes nothing to this
  list, so its tickets simply won't come back from Jira until you set one.

Either way, the default query is deliberately the **full open backlog** (`statusCategory != Done`), not just
recent deltas — this is what lets Ticket Pipeline show every open ticket, including ones that haven't changed
status recently, not only ones caught mid-transition. This is safe to poll broadly: the poller only ever
*acts* on a genuine status change (`diffIssues` compares each issue against that ticket's own persisted
`last_seen_status`, which is seeded to the current status the first time a ticket is ever seen — see
`src/poller/index.js`), so a wide query only adds visibility, it can never replay an action or synthesize a
transition that didn't happen.

**The `OR updated >= -15m` half of the clause is load-bearing, not decorative.** A plain `statusCategory !=
Done` excludes a ticket from *every* future search the instant it becomes Done — including the very next
poll, the one that's supposed to notice it just transitioned there. Without the OR, moving a ticket to
"Approved"/"Done" would silently do nothing: the search that's meant to catch the transition would have
already filtered the ticket out before `diffIssues` ever saw it. The OR clause keeps a just-transitioned
ticket visible for one last 15-minute window — comfortably longer than the default `POLL_INTERVAL_MS`
(60s) — so the diff (and the resulting `toDevelop` PR-open) actually fires, before the ticket ages out of
view for good.

`ORDER BY updated ASC` isn't required (the poller re-sorts by `fields.updated` before processing) but keeps
the raw response readable if you're inspecting it by hand. If you'd rather keep the narrower "only recently
changed" behavior (accepting that it won't reliably catch transitions into a Done-category status — see
above), set `JIRA_POLL_CLAUSE=status CHANGED AFTER -5m` (or similar) in `.env`.

## Verifying the poller is picking up transitions

1. Start the API with `DRY_RUN=true` first — this logs every intended Jira comment and GitHub write instead of
   performing them, so you can watch the flow safely against a real Jira project before going live.
2. Watch the logs (structured JSON via `pino`) for `poll failed` / lines with a `correlationId`, or hit:
   - `GET /api/health` — `poller.lastPollAt`, `poller.lastPollOk`, `poller.cursor`, `poller.nextPollAt`.
   - `GET /api/events` — every detected transition and the action taken, oldest last.
3. Move a ticket through a watched status transition in Jira. Within one `POLL_INTERVAL_MS`, it should appear
   in `GET /api/tickets` with an updated `pipelineState`, and a new row in `GET /api/events`.
4. Once you trust the behaviour, set `DRY_RUN=false` to let it actually merge branches and post comments.

## Concurrency & safety

- Every git ref write goes through a named lock (`refs/heads/staging`, `refs/heads/develop`) so two merges into
  the same branch never race; different branches merge in parallel. Current lock state is in
  `GET /api/health`, history in the event log (`LOCK` outcome).
- `POST /api/staging/reset` takes the `staging` lock non-blocking — if a poller-driven merge is already
  writing to staging, it returns `409` immediately rather than queuing behind it.
- GitHub 5xx responses on writes retry up to 3 times with backoff; a `409` (conflict) is never retried — it's
  a terminal, expected business outcome (surfaced as `CONFLICT` in the event log and a Jira comment).
- Jira `429` responses back off honoring `Retry-After` when present.

## Tests

```bash
npm test
```

Vitest, with the Jira and GitHub HTTP clients mocked via `nock` and an in-memory SQLite database per test file.
Covers all three event handlers (success/conflict/held/no-match/dry-run paths), the ref-lock's serialization
and non-blocking-reject behaviour, retry/backoff edge cases on both clients, and the API routes' auth and
response shapes.
