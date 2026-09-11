/**
 * Fixed Stage2Prod lifecycle stages. Operators map each stage to the
 * Jira status name(s) their project actually uses.
 *
 * Git → Jira:
 *   branch created          → in_progress
 *   PR opened to staging    → in_qa
 *   PR opened to production → ready_for_release
 *   merged to production    → done
 *
 * Jira → Git (poller):
 *   entering in_qa              → open staging PR
 *   entering ready_for_release  → open production PR
 */

const PIPELINE_STAGES = Object.freeze({
  open: {
    id: 'open',
    label: 'Open',
    detail: 'Not started — To Do / Open / Backlog.',
  },
  in_progress: {
    id: 'in_progress',
    label: 'In progress',
    detail: 'Branch created; work in progress.',
  },
  in_qa: {
    id: 'in_qa',
    label: 'In QA',
    detail: 'PR opened (or merged) into staging for QA.',
  },
  ready_for_release: {
    id: 'ready_for_release',
    label: 'Ready for release',
    detail: 'PR opened into production after QA.',
  },
  done: {
    id: 'done',
    label: 'Done',
    detail: 'Merged into production.',
  },
});

const STAGE_IDS = Object.freeze(Object.keys(PIPELINE_STAGES));

/** @deprecated Old Jira-status → git-action map shape. */
const LEGACY_HANDLER_IDS = new Set(['toStaging', 'toDevelop', 'rejected']);

function defaultStatusMap() {
  return {
    open: { jiraStatus: 'Open', match: ['Open', 'To Do', 'Todo', 'Backlog'] },
    in_progress: { jiraStatus: 'In Progress', match: ['In Progress', 'In Development'] },
    in_qa: { jiraStatus: 'In QA', match: ['In QA'] },
    ready_for_release: { jiraStatus: 'Ready for Release', match: ['Ready for Release', 'Approved'] },
    done: { jiraStatus: 'Done', match: ['Done'] },
  };
}

function normalizeMatchList(primary, match) {
  const list = [];
  const seen = new Set();
  const add = (value) => {
    const name = String(value || '').trim();
    if (!name) return;
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    list.push(name);
  };
  add(primary);
  if (Array.isArray(match)) match.forEach(add);
  else if (typeof match === 'string') {
    match.split(',').forEach(add);
  }
  return list;
}

function normalizeStageEntry(raw) {
  if (raw == null) return null;
  if (typeof raw === 'string') {
    const jiraStatus = raw.trim();
    if (!jiraStatus) return null;
    return { jiraStatus, match: normalizeMatchList(jiraStatus) };
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) return null;
  const jiraStatus = String(raw.jiraStatus || raw.status || raw.name || '').trim();
  if (!jiraStatus) return null;
  return { jiraStatus, match: normalizeMatchList(jiraStatus, raw.match || raw.aliases) };
}

function looksLikeLegacyHandlerMap(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false;
  return Object.values(input).some((v) => typeof v === 'string' && LEGACY_HANDLER_IDS.has(v));
}

/**
 * Normalize stored/posted map into
 * `{ open: { jiraStatus, match[] }, in_progress: {...}, ... }`.
 * Legacy Jira→action maps are ignored (caller falls back to defaults).
 */
function normalizeStatusMap(input) {
  if (input == null) return null;
  if (typeof input === 'string') {
    try {
      input = JSON.parse(input);
    } catch {
      return null;
    }
  }
  if (typeof input !== 'object' || Array.isArray(input)) return null;
  if (looksLikeLegacyHandlerMap(input)) return null;

  const out = {};
  for (const stageId of STAGE_IDS) {
    const entry = normalizeStageEntry(input[stageId]);
    if (entry) out[stageId] = entry;
  }
  return Object.keys(out).length ? out : null;
}

function effectiveStatusMap(repoOrJson) {
  const stored =
    repoOrJson && typeof repoOrJson === 'object' && !Array.isArray(repoOrJson) && 'statusHandlerMap' in repoOrJson
      ? repoOrJson.statusHandlerMap
      : repoOrJson && typeof repoOrJson === 'object' && 'statusMap' in repoOrJson
        ? repoOrJson.statusMap
        : repoOrJson;
  const normalized = normalizeStatusMap(stored);
  const defaults = defaultStatusMap();
  if (!normalized) return defaults;
  // Fill any missing stages from defaults so partial saves still work.
  const merged = { ...defaults };
  for (const stageId of STAGE_IDS) {
    if (normalized[stageId]) merged[stageId] = normalized[stageId];
  }
  return merged;
}

function jiraStatusForStage(stageId, map) {
  const resolved = effectiveStatusMap(map);
  return resolved[stageId]?.jiraStatus || defaultStatusMap()[stageId]?.jiraStatus || null;
}

function stageForJiraStatus(status, map) {
  if (!status) return null;
  const needle = String(status).trim().toLowerCase();
  const resolved = effectiveStatusMap(map);
  for (const stageId of STAGE_IDS) {
    const entry = resolved[stageId];
    if (!entry) continue;
    if ((entry.match || []).some((name) => name.toLowerCase() === needle)) return stageId;
    if (entry.jiraStatus && entry.jiraStatus.toLowerCase() === needle) return stageId;
  }
  return null;
}

/** Poller: which git handler (if any) a Jira status should trigger. */
function handlerForStatus(status, map) {
  const stage = stageForJiraStatus(status, map);
  if (stage === 'in_qa') return 'toStaging';
  if (stage === 'ready_for_release') return 'toDevelop';
  return null;
}

// Back-compat aliases used by reposRepo / routes while renaming settles.
const defaultStatusHandlerMap = defaultStatusMap;
const normalizeStatusHandlerMap = normalizeStatusMap;
const effectiveStatusHandlerMap = effectiveStatusMap;

module.exports = {
  PIPELINE_STAGES,
  STAGE_IDS,
  defaultStatusMap,
  normalizeStatusMap,
  effectiveStatusMap,
  jiraStatusForStage,
  stageForJiraStatus,
  handlerForStatus,
  defaultStatusHandlerMap,
  normalizeStatusHandlerMap,
  effectiveStatusHandlerMap,
};
