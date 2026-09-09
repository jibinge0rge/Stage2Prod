// These map 1:1 onto tokens.css's brand/semantic/neutral custom
// properties (not raw hex) so every badge automatically follows the
// light/dark theme rather than needing its own dark variant.
export const PIPELINE_STATE_STYLES = {
  staging: { label: 'On staging', fg: 'var(--brand-hover)', bg: 'var(--brand-fill-selected)', border: 'var(--brand-border-light)', dashed: false },
  queued: { label: 'Awaiting develop', fg: 'var(--n-body)', bg: 'var(--n-fill-subtle)', border: 'var(--n-border-strong)', dashed: true },
  develop: { label: 'Merged to develop', fg: 'var(--success-text)', bg: 'var(--success-fill)', border: 'var(--success)', dashed: false },
  conflict: { label: 'Merge conflict', fg: 'var(--danger)', bg: 'var(--danger-fill)', border: 'var(--danger-border)', dashed: true },
  rejected: { label: 'QA rejected', fg: 'var(--warning)', bg: 'var(--warning-fill)', border: 'var(--n-border-strong)', dashed: true },
  unmerged: { label: 'Not merged', fg: 'var(--n-muted)', bg: 'var(--n-fill-subtle)', border: 'var(--n-border-strong)', dashed: true },
  held: { label: 'Held', fg: 'var(--warning)', bg: 'var(--warning-fill)', border: 'var(--n-border-strong)', dashed: true },
};

export const OUTCOME_STYLES = {
  MERGED: { bg: 'var(--success-fill)', fg: 'var(--success-text)' },
  RESET: { bg: 'var(--success-fill)', fg: 'var(--success-text)' },
  CONFLICT: { bg: 'var(--danger-fill)', fg: 'var(--danger)' },
  HELD: { bg: 'var(--n-fill-subtle)', fg: 'var(--n-muted)' },
  NOTED: { bg: 'var(--n-fill-subtle)', fg: 'var(--n-muted)' },
  LOCK: { bg: 'var(--n-fill-subtle)', fg: 'var(--n-muted)' },
};

export function pipelineStyle(state) {
  return PIPELINE_STATE_STYLES[state] || PIPELINE_STATE_STYLES.unmerged;
}

export function outcomeStyle(outcome) {
  return OUTCOME_STYLES[outcome] || OUTCOME_STYLES.NOTED;
}

export function checkStatusColor(checkStatus) {
  if (checkStatus === 'failing') return 'var(--danger)';
  if (checkStatus === 'pending') return 'var(--warning)';
  if (!checkStatus || checkStatus === '—') return 'var(--n-muted)';
  return 'var(--success-text)';
}

export function isDashedState(state) {
  return state === 'conflict' || state === 'rejected' || state === 'queued';
}
