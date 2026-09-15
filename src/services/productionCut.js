const { OUTCOMES, refKey } = require('../lib/constants');
const { ticketKeysInText } = require('../lib/jiraKey');

class CutNotReadyError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

function defaultCutBranchName(now = new Date()) {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  return `release-${y}-${m}-${d}`;
}

/** Production cuts are branches whose names start with "release" (e.g. release-4.3.0-v1). */
function isReleaseCutName(branchName, stagingBranch) {
  if (!branchName) return false;
  if (stagingBranch && branchName === stagingBranch) return false;
  return /^release/i.test(String(branchName));
}

function sortReleaseCutsNewestFirst(a, b) {
  const aName = a.branchName || a.name || '';
  const bName = b.branchName || b.name || '';
  return bName.localeCompare(aName, undefined, { numeric: true, sensitivity: 'base' });
}

function assertValidCutBranchName(name, stagingBranch) {
  const trimmed = String(name || '').trim();
  if (!trimmed) {
    throw new CutNotReadyError('branch name is required');
  }
  if (!isReleaseCutName(trimmed, stagingBranch)) {
    throw new CutNotReadyError('production cut branch name must start with "release" (e.g. release-4.3.0-v1)');
  }
  if (trimmed.length > 200) {
    throw new CutNotReadyError('branch name is too long (max 200 characters)');
  }
  if (
    /[\s~^:?*[\]\\]/.test(trimmed) ||
    trimmed.includes('..') ||
    trimmed.includes('@{') ||
    trimmed.startsWith('/') ||
    trimmed.endsWith('/') ||
    trimmed.startsWith('.') ||
    trimmed.endsWith('.lock')
  ) {
    throw new CutNotReadyError(`invalid branch name "${trimmed}"`);
  }
  return trimmed;
}

async function shaOrNull(github, branch) {
  if (!branch) return null;
  try {
    return await github.getRef(branch);
  } catch (err) {
    if (err.status === 404) return null;
    throw err;
  }
}

function commitText(commit) {
  return [commit?.commit?.message, commit?.html_url, commit?.sha].filter(Boolean).join('\n');
}

async function ticketsForRepo(ticketsRepo, owner, name) {
  const all = await ticketsRepo.list();
  return all.filter((t) => t.repo_owner === owner && t.repo_name === name);
}

/**
 * Tickets whose keys (or feature branch names) appear in commits that
 * landed on staging since the previous production cut (or configured
 * production branch, if this is the first cut).
 */
async function ticketsFromCommits(commits, { ticketsRepo, owner, name }) {
  const repoTickets = await ticketsForRepo(ticketsRepo, owner, name);
  const found = new Map();

  for (const commit of commits || []) {
    const text = commitText(commit);
    for (const key of ticketKeysInText(text)) {
      if (found.has(key)) continue;
      // eslint-disable-next-line no-await-in-loop
      const row = await ticketsRepo.get(key);
      if (row) found.set(key, row);
    }
    for (const row of repoTickets) {
      if (found.has(row.ticket_key)) continue;
      if (text.includes(row.ticket_key) || (row.branch_name && text.includes(row.branch_name))) {
        found.set(row.ticket_key, row);
      }
    }
  }

  return [...found.values()].map((row) => ({
    key: row.ticket_key,
    summary: row.summary || null,
    pipelineState: row.pipeline_state || null,
  }));
}

async function trackedTickets(tickets, ticketsRepo) {
  const list = tickets || [];
  const rows = await Promise.all(list.map((t) => (t?.key ? ticketsRepo?.get?.(t.key) : null)));
  return list.filter((_, i) => Boolean(rows[i]));
}

async function summarizeCut(cut, { isLatest = false, ticketsRepo } = {}) {
  const tickets = await trackedTickets(cut.tickets, ticketsRepo);
  return {
    id: cut.id,
    branchName: cut.branchName,
    sha: cut.sha,
    stagingSha: cut.stagingSha,
    previousSha: cut.previousSha,
    createdAt: cut.createdAt,
    ticketCount: tickets.length,
    isLatest,
  };
}

async function hydrateCut(cut, ticketsRepo) {
  const tracked = await trackedTickets(cut.tickets, ticketsRepo);
  const tickets = await Promise.all(
    tracked.map(async (t) => {
      const row = await ticketsRepo.get(t.key);
      return {
        key: t.key,
        summary: row?.summary || t.summary || null,
        pipelineState: row?.pipeline_state || t.pipelineState || null,
      };
    })
  );
  return { ...cut, tickets, ticketCount: tickets.length };
}

async function listedReleaseCuts(owner, name, cutsRepo) {
  const list = (await cutsRepo?.list(owner, name)) || [];
  return list.filter((cut) => isReleaseCutName(cut.branchName)).sort(sortReleaseCutsNewestFirst);
}

async function previousTip({ repo, cutsRepo }) {
  const existing = await listedReleaseCuts(repo.owner, repo.name, cutsRepo);
  if (existing[0]) {
    return { sha: existing[0].sha, from: existing[0].branchName };
  }
  return { sha: null, from: null };
}

async function changelogFromStaging({
  owner,
  name,
  reposRepo,
  cutsRepo,
  ticketsRepo,
  repoResolver,
}) {
  const repo = await reposRepo.get(owner, name);
  if (!repo || !repo.active) {
    const err = new Error(`${owner}/${name} is not a watched repo`);
    err.status = 404;
    throw err;
  }

  const github = repoResolver.getClient(owner, name);
  const stagingSha = await shaOrNull(github, repo.stagingBranch);
  if (!stagingSha) {
    throw new CutNotReadyError(
      `Staging branch "${repo.stagingBranch}" was not found in ${owner}/${name}.`
    );
  }

  const previous = await previousTip({ repo, cutsRepo });
  let commits = [];
  if (previous.sha && previous.sha !== stagingSha) {
    commits = await github.listCommitsAhead(previous.sha, repo.stagingBranch).catch(() => []);
  } else if (!previous.sha) {
    commits = [];
  }

  let tickets = await ticketsFromCommits(commits, { ticketsRepo, owner, name });
  if (!previous.sha && tickets.length === 0) {
    const staged = await ticketsRepo.listByPipelineStateAndRepo('staging', owner, name);
    tickets = staged.map((row) => ({
      key: row.ticket_key,
      summary: row.summary || null,
      pipelineState: row.pipeline_state,
    }));
  }

  return {
    repo: { owner, name, productionBranch: repo.productionBranch, stagingBranch: repo.stagingBranch },
    stagingSha,
    previousSha: previous.sha,
    previousFrom: previous.from,
    alreadyInSync: Boolean(previous.sha && previous.sha === stagingSha),
    tickets,
    commitCount: Array.isArray(commits) ? commits.length : 0,
    suggestedName: defaultCutBranchName(),
  };
}

async function uniqueDefaultName({ github, cutsRepo, owner, name, base }) {
  let candidate = base;
  let n = 2;
  // eslint-disable-next-line no-await-in-loop
  while ((await cutsRepo.getByBranch(owner, name, candidate)) || (await shaOrNull(github, candidate))) {
    candidate = `${base}-${n}`;
    n += 1;
    if (n > 50) {
      throw new CutNotReadyError(`could not find a free branch name starting from "${base}"`);
    }
  }
  return candidate;
}

/**
 * Creates a production branch at the current staging SHA and records
 * which tickets came along from staging (vs the previous cut).
 */
async function createProductionCut({
  owner,
  name,
  branchName,
  reposRepo,
  cutsRepo,
  ticketsRepo,
  eventsRepo,
  repoResolver,
  lockManager,
  log,
  correlationId,
  trigger = 'POST /api/repos/:owner/:name/cuts',
}) {
  const repo = await reposRepo.get(owner, name);
  if (!repo || !repo.active) {
    const err = new Error(`${owner}/${name} is not a watched repo`);
    err.status = 404;
    throw err;
  }

  const github = repoResolver.getClient(owner, name);
  const changelog = await changelogFromStaging({
    owner,
    name,
    reposRepo,
    cutsRepo,
    ticketsRepo,
    repoResolver,
  });

  let nameToUse;
  if (branchName === undefined || branchName === null || String(branchName).trim() === '') {
    nameToUse = await uniqueDefaultName({
      github,
      cutsRepo,
      owner,
      name,
      base: changelog.suggestedName,
    });
  } else {
    nameToUse = assertValidCutBranchName(branchName, repo.stagingBranch);
  }

  if (nameToUse === repo.stagingBranch) {
    throw new CutNotReadyError(`cut branch cannot be this repo's staging branch ("${repo.stagingBranch}")`);
  }
  if (await cutsRepo.getByBranch(owner, name, nameToUse)) {
    throw new CutNotReadyError(`a production cut named "${nameToUse}" already exists`);
  }
  if (await shaOrNull(github, nameToUse)) {
    throw new CutNotReadyError(`branch "${nameToUse}" already exists on ${owner}/${name}`);
  }

  const lockName = refKey(owner, name, `refs/heads/${nameToUse}`);
  const run = async () => {
    let sha = changelog.stagingSha;
    try {
      const created = await github.createRef(nameToUse, changelog.stagingSha);
      sha = created.sha || changelog.stagingSha;
    } catch (err) {
      if (err.status === 422) {
        throw new CutNotReadyError(`branch "${nameToUse}" already exists on ${owner}/${name}`);
      }
      throw err;
    }

    const cut = await cutsRepo.insert({
      repoOwner: owner,
      repoName: name,
      branchName: nameToUse,
      sha,
      stagingSha: changelog.stagingSha,
      previousSha: changelog.previousSha,
      tickets: changelog.tickets,
    });

    await eventsRepo.insertEvent({
      trigger,
      action: 'create-cut',
      outcome: OUTCOMES.NOTED,
      title: `Cut ${nameToUse} from staging`,
      detail: `Created ${nameToUse} at ${String(sha).slice(0, 7)} from ${repo.stagingBranch} with ${changelog.tickets.length} ticket${changelog.tickets.length === 1 ? '' : 's'}.`,
      correlationId,
      metadata: {
        branch: nameToUse,
        sha,
        stagingSha: changelog.stagingSha,
        previousSha: changelog.previousSha,
        tickets: changelog.tickets.map((t) => t.key),
      },
      repoOwner: owner,
      repoName: name,
    });
    log?.info?.({ owner, name, branch: nameToUse, sha, ticketCount: changelog.tickets.length }, 'production cut created');

    return hydrateCut(cut, ticketsRepo);
  };

  if (lockManager?.withLock) {
    return lockManager.withLock(lockName, 'create-cut', correlationId, run);
  }
  return run();
}

async function listCutsForRepo(owner, name, cutsRepo, ticketsRepo) {
  const cuts = await listedReleaseCuts(owner, name, cutsRepo);
  return Promise.all(cuts.map((cut, i) => summarizeCut(cut, { isLatest: i === 0, ticketsRepo })));
}

/**
 * Treats every GitHub branch whose name starts with "release" as a production
 * cut (except the staging branch). Records them so Overview can list
 * newest-first and open a ticket changelog.
 */
async function syncReleaseCutsFromGithub({
  github,
  cutsRepo,
  ticketsRepo,
  owner,
  name,
  stagingBranch,
}) {
  if (!cutsRepo) return [];
  if (typeof github?.listBranches !== 'function') {
    return listCutsForRepo(owner, name, cutsRepo, ticketsRepo);
  }

  let branches = [];
  try {
    branches = await github.listBranches();
  } catch {
    return listCutsForRepo(owner, name, cutsRepo, ticketsRepo);
  }

  const releaseBranches = (branches || [])
    .filter((b) => isReleaseCutName(b.name, stagingBranch))
    .sort(sortReleaseCutsNewestFirst);

  const oldestFirst = [...releaseBranches].reverse();
  let previousSha = null;
  for (const branch of oldestFirst) {
    // eslint-disable-next-line no-await-in-loop
    const sha = branch.commit?.sha || (await shaOrNull(github, branch.name));
    if (!sha) continue;
    // eslint-disable-next-line no-await-in-loop
    const existing = await cutsRepo.getByBranch(owner, name, branch.name);
    // eslint-disable-next-line no-await-in-loop
    const storedTicketRows = existing
      ? await Promise.all((existing.tickets || []).map((t) => ticketsRepo?.get?.(t.key)))
      : [];
    const storedUntracked = storedTicketRows.some((row) => !row);
    const needsTickets = !existing || existing.sha !== sha || !(existing.tickets || []).length || storedUntracked;
    let tickets = existing?.tickets || [];
    if (needsTickets) {
      let commits = [];
      if (previousSha && previousSha !== sha && typeof github.listCommitsAhead === 'function') {
        // eslint-disable-next-line no-await-in-loop
        commits = await github.listCommitsAhead(previousSha, branch.name).catch(() => []);
      }
      // eslint-disable-next-line no-await-in-loop
      tickets = await ticketsFromCommits(commits, { ticketsRepo, owner, name });
    }
    if (!existing) {
      // eslint-disable-next-line no-await-in-loop
      await cutsRepo.insert({
        repoOwner: owner,
        repoName: name,
        branchName: branch.name,
        sha,
        stagingSha: sha,
        previousSha,
        tickets,
      });
    } else if (existing.sha !== sha || storedUntracked || (!(existing.tickets || []).length && tickets.length)) {
      // eslint-disable-next-line no-await-in-loop
      await cutsRepo.update(existing.id, { sha, previousSha, tickets });
    }
    previousSha = sha;
  }

  return listCutsForRepo(owner, name, cutsRepo, ticketsRepo);
}

module.exports = {
  CutNotReadyError,
  defaultCutBranchName,
  assertValidCutBranchName,
  isReleaseCutName,
  changelogFromStaging,
  createProductionCut,
  hydrateCut,
  listCutsForRepo,
  summarizeCut,
  ticketsFromCommits,
  syncReleaseCutsFromGithub,
};
