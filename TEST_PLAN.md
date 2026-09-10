# Stage2Prod — manual UI test plan

Use this against your test GitHub repo + test Jira project only. Actions here are real (merges, branch
deletes, Jira comments/transitions) unless `DRY_RUN=true` — check `GET /api/health`'s `dryRun` field or the
Rules & polling page before starting if you want a no-op dry run first.

Legend: ✅ expected result — check it actually happened, don't just check "no error".

---

## 0. Setup

- [ ] `.env` points `GITHUB_TOKEN` at an account that can read/write your **test** repo, and
      `JIRA_HOST`/`JIRA_EMAIL`/`JIRA_API_TOKEN` at your **test** Jira site.
- [ ] Backend running (`npm run dev:api` or `npm start`), frontend at `http://localhost:5173` (or the built
      app on the backend's port).
- [ ] Test repo has at least a `develop`-equivalent branch and a `staging`-equivalent branch already, or is
      happy to let Stage2Prod use its default branch as production and create/track a staging branch.
- [ ] Test Jira project has (or you can create) a handful of issues you can freely transition through
      statuses without affecting anyone else.

---

## 1. Connecting the repo

1. [ ] Open **Repositories**. Click **Connect a repository**.
   - ✅ A list of repos your `GITHUB_TOKEN` can see loads (search box filters it).
2. [ ] Find your test repo, confirm the production-branch field pre-fills to its real GitHub default branch.
3. [ ] Set the staging branch name (create one first in GitHub if you don't have one) and optionally a Jira
       project key (your test project's key, e.g. `TEST`). Click **Watch**.
   - ✅ Row flips to "Watching"; repo now appears under **Watched repositories** with the branch names and
     (if set) a `Jira: TEST` badge — or an orange **no Jira project** badge if you left it blank.
4. [ ] Without reloading the page, check the sidebar's repo selector (top-left) — the new repo should appear
       there **immediately**, not only after a manual refresh.
5. [ ] Click **Edit** on the watched repo row, change the Jira project key (or clear it), **Save**.
   - ✅ Badge updates immediately; sidebar "Branch model" legend and repo selector stay in sync.
6. [ ] Go to **Rules & polling** → **JQL watched** box.
   - ✅ Once a project key is set on at least one repo, this shows
     `project in ("TEST") AND (statusCategory != Done OR updated >= -15m) ORDER BY updated ASC` (not the old static default).

---

## 2. Full ticket lifecycle (core workflow)

**Merging is now always a manual click.** Every status transition below only ever gets Stage2Prod as far as
*opening a PR* and posting a Jira comment saying so — the actual GitHub merge happens only when you click
**Merge** in the ticket drawer (see §2a). Nothing here should land a real commit on `staging` or `develop`
without that explicit click.

Pick or create a Jira issue in your test project with a matching feature branch already pushed to the repo
(branch name containing the ticket key, e.g. `feat/TEST-101-something`), or create the branch after step 1.

1. [ ] Set the ticket's Jira status to **In Development**. Wait for a poll (or click **Sync now** — note this
       refreshes the dashboard's own view; the poller itself still runs on its own interval, shown as
       "next poll" on Rules & polling).
   - ✅ Ticket appears on **Ticket pipeline** as `unmerged`. **No git action** — Event log shows a `NOTED`
     entry, not a merge.
2. [ ] Move it to **Ready for QA** (or **In QA**).
   - ✅ Within one poll interval: a **PR** (not a direct merge) opens from the feature branch into the
     staging branch on GitHub — check GitHub directly, it should be an open, unmerged PR. Pipeline state
     becomes `staging_queued` ("Awaiting staging merge"). Event log shows a `PR_OPENED` / `pr:staging`
     entry, **not** `MERGED`. A comment appears on the Jira ticket saying a PR was opened.
   - ✅ **Overview** → branch board's staging column lists this ticket as awaiting merge, not as already on
     staging.
3. [ ] Open the ticket drawer and click **Merge PR into staging** (see §2a for the full drawer walkthrough).
   - ✅ *Now* the PR actually merges on GitHub. Pipeline state becomes `staging`. Event log shows `MERGED` /
     `merge:staging`. The feature branch is **not** deleted (still needed for the develop PR next).
4. [ ] Move it to **Approved** (or **Ready for Release** / **Done**).
   - ✅ A PR opens into the production branch (or an already-existing one is reused) — again, not merged yet.
     Pipeline state becomes `queued` ("Awaiting production"). Event log shows `PR_OPENED` / `pr:develop`. Status
     checks (if any) are shown in the drawer's GitHub panel but don't block anything at this stage.
5. [ ] Click **Merge PR into develop** in the drawer.
   - ✅ The PR merges as a merge commit (never squashed), and the remote feature branch **is** deleted this
     time. Pipeline state becomes `develop`. Event log shows `MERGED` / `merge:develop`. A comment appears on
     Jira.
   - ✅ **Overview** → branch board's production column lists this ticket; "Merged today" KPI increments.
6. [ ] Pick a second ticket, move it straight to **QA Failed** (skip staging).
   - ✅ No git action taken. PR gets labelled `qa-rejected` on GitHub. A comment appears on Jira. Pipeline
     state becomes `rejected`. Ticket pipeline shows it clearly as rejected, not silently dropped.
7. [ ] Move a ticket to a status **not** in the mapping table (e.g. back to **In Development** after being on
       staging).
   - ✅ No git action; last-seen status still updates so the same transition doesn't re-fire next poll.

## 2a. In-app ticket actions (drawer)

Open any ticket from **Ticket pipeline** to get its drawer.

1. [ ] **Transition Jira status** — use the "Move to…" dropdown (populated from that ticket's real available
       Jira transitions).
   - ✅ The real Jira issue's status changes immediately (check in Jira). The dashboard doesn't wait for the
     next scheduled poll — it should reflect any resulting PR-open within a second or two (an out-of-cycle
     poll runs right after the transition).
2. [ ] **Comment on Jira** — type something in the box, click **Post comment**.
   - ✅ Comment appears on the real Jira issue.
3. [ ] **Merge** button — only appears when pipeline state is "Awaiting staging merge" or "Awaiting production"
       (i.e. a PR is actually open). Click it.
   - ✅ See §2 steps 3/5 for the expected effect. If you click it when there's genuinely nothing to merge
     (shouldn't be reachable via the UI, but worth confirming), it's rejected with a clear error, not a crash.
4. [ ] **Open in Jira** — click it.
   - ✅ Opens the real ticket at `https://<your Jira host>/browse/<KEY>` in a new tab (only enabled once
     `JIRA_HOST` is configured in `.env`).

---

## 2b. Full open-ticket backlog

1. [ ] In Jira, find (or leave) an issue in your test project that's open but hasn't changed status
       recently, and that Stage2Prod has never polled before (or restart the backend with a fresh
       `data/*.db` to be sure).
   - ✅ It shows up on **Ticket pipeline** anyway — Stage2Prod no longer only shows tickets that recently
     transitioned. Its pipeline state is whatever's appropriate for its current status (likely `unmerged`),
     not blank/missing.
   - ✅ No spurious action was taken on it (check Event log) — seeing an old ticket for the first time must
     never look like a fresh transition and trigger a PR-open.
2. [ ] Use the search box (ticket key, branch, summary, or repo) and confirm it filters across this fuller
       list, not just recently-active tickets.

## 3. Conflict handling

Conflict detection now happens at **merge time**, not when the PR is opened — GitHub will happily create a
PR that can't merge cleanly, it just refuses the merge itself.

1. [ ] Create a feature branch whose merge into staging will conflict (edit the same file/line staging
       already has changes on).
2. [ ] Move that ticket to **Ready for QA**.
   - ✅ A PR still opens successfully (GitHub allows creating a non-mergeable PR). Pipeline state is
     `staging_queued`, same as any other PR-opened ticket — no conflict is reported yet.
3. [ ] Open the drawer and click **Merge PR into staging**.
   - ✅ *This* is where it fails: Stage2Prod does **not** attempt to auto-resolve it. Pipeline state becomes
     `conflict`. Event log shows a `CONFLICT` outcome. Jira gets a comment saying the PR can't merge cleanly.
     The drawer surfaces a clear error, not a raw GitHub error.
   - ✅ **Overview** shows the red **Conflicts** KPI and conflict banner; ticket pipeline flags it.
4. [ ] Resolve the conflict manually in GitHub (or discard by resetting staging, see §4), then click **Merge**
       again from the drawer and confirm it now succeeds.

---

## 4. Staging reset

1. [ ] Go to **Staging sandbox**. Confirm "Commits ahead" / "Tickets merged" reflect real state.
2. [ ] Click **Reset staging to `<production>`**, confirm in the modal (toggle "re-merge tickets in QA" on
       or off to test both).
   - ✅ Staging branch is force-updated to production's current SHA (deleting anything unmerged that was only
     on staging). If re-merge was on, every ticket still "In QA" in Jira gets a **staging PR re-opened** in
     sequence (not auto-merged — same manual-merge rule as everywhere else) — check Event log for a `RESET`
     entry plus one `PR_OPENED` / `pr:staging` entry per ticket, landing each in `staging_queued`. You still
     need to click **Merge** per ticket afterward if you want them actually back on staging.
   - ✅ Rejected/staging-state tickets from before the reset flip back to `unmerged` (not silently left
     pointing at a branch reference that no longer exists on staging).

---

## 5. Repo resolution edge cases

Only relevant if you connect a **second** test repo.

1. [ ] Watch a second repo without setting a Jira project key. Create a ticket whose key doesn't match either
       repo's branches.
   - ✅ Event log shows "No matching repo found" (`NOTED`), no git action, no crash.
2. [ ] Give the two repos **different** Jira project keys, matching their respective ticket prefixes.
   - ✅ A ticket resolves to the correct repo directly (check the ticket drawer's repo field, or that the
     merge happens in the right repo) even before you've confirmed there's no ambiguity.
3. [ ] Push a same-looking branch name (containing the same ticket key) to **both** watched repos, on a
       ticket whose project key doesn't uniquely map to one repo (or give both repos the same project key).
   - ✅ Event log shows "Ambiguous repo match" (`NOTED`) naming both candidate repos; no git action taken
     until you rename one branch or unwatch one repo.

---

## 6. Untracked changes

1. [ ] Push a branch to the test repo whose name does **not** contain any tracked ticket key, and/or open a
       PR from it into the staging or production branch.
2. [ ] Directly merge something into the staging branch outside of Stage2Prod (a manual PR merge, or a
       maintainer pushing straight to it) without a ticket key in the commit message.
3. [ ] Open **Untracked changes**.
   - ✅ The stray PR(s) show up under "Open PRs without a ticket → `<staging>`" or "→ `<production>`"
     depending on their base branch.
   - ✅ The manual staging commit shows up under "Untracked merges on `<staging>`", with a note that staging
     is disposable (not an alarm).
   - ✅ Nothing here got merged, deleted, or otherwise touched automatically — it's read-only.

---

## 7. Multi-repo dashboard behavior

Only relevant with 2+ watched repos.

1. [ ] Sidebar repo selector: switch between "All repos", and each individual repo.
   - ✅ **Overview**, **Ticket pipeline**, **Staging sandbox**, and **Untracked changes** all filter to just
     the selected repo (or show all, stacked, under "All repos").
2. [ ] With "All repos" selected and more than one repo watched, check the sidebar's "Branch model" legend.
   - ✅ Shows generic "Production"/"Staging" labels (not one repo's real branch names presented as universal),
     with a note pointing at Repositories. Selecting a single specific repo shows its real branch names.
3. [ ] Confirm the **Overview** branch board's staging column shows an "N without a ticket →" link (in
       warning color) when that repo has untracked staging commits (from §6), and that it links to
       **Untracked changes**.

---

## 8. General UI checks

1. [ ] Theme toggle (top bar): switch Light / Dark / Auto.
   - ✅ Whole app re-themes immediately and persists across a reload. Sidebar nav icons are visible in dark
     mode (not invisible/black-on-black).
2. [ ] Open any dropdown (repo selector, branch pickers on Repositories) in dark mode.
   - ✅ Popup is fully styled (not a broken native OS dropdown), matches the current theme, closes on
     click-outside and `Escape`.
3. [ ] **Overview** branch board: confirm the **production** branch column renders first (left), staging
       second (right).
4. [ ] Navigate between tabs (Overview → Ticket pipeline → Staging sandbox, etc.) at normal speed.
   - ✅ A thin loading bar briefly appears under the top bar while each page's data is fetching, so slow
     loads (e.g. Overview, which makes live GitHub calls) are visibly "in progress" rather than looking frozen.
5. [ ] **Event log**: paginate with "Newer"/"Older", confirm counts and ordering make sense against what
       you've done above.
6. [ ] **Rules & polling**: confirm "Jira polling" and "Merge policy" cards are the same height and line up
       at the bottom edge.
7. [ ] Click **Sync now** from any page.
   - ✅ That page's data refetches immediately (spinner/loading bar reflects it); no full page reload needed.

---

## 9. Cleanup

- [ ] **Stop watching** the test repo(s) from Repositories when done (soft-remove — history stays in the DB).
- [ ] Revert any test Jira issues to their original status if this is a shared test project.
- [ ] Delete any throwaway branches/PRs created for §3/§6 that you don't want lingering in the test repo.
