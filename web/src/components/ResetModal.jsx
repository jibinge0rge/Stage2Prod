import { useEffect, useState } from 'react';
import styles from '../layout/AppShell.module.css';
import { useAppContext } from '../context/AppContext';
import { getJson } from '../lib/api';

export default function ResetModal() {
  const { resetTarget, closeReset, remergeInQa, toggleRemerge, confirmReset, resetting } = useAppContext();
  const [branches, setBranches] = useState(null);

  useEffect(() => {
    if (resetTarget) getJson('/branches').then(setBranches).catch(() => setBranches(null));
  }, [resetTarget]);

  useEffect(() => {
    if (!resetTarget) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape' && !resetting) closeReset();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [resetTarget, resetting, closeReset]);

  if (!resetTarget) return null;

  const entry = branches?.repos?.find((r) => r.repo.owner === resetTarget.owner && r.repo.name === resetTarget.name);
  const ahead = entry?.staging?.commitsAheadOfDevelop ?? '—';
  const tickets = entry?.staging?.tickets ?? [];
  const onStagingCount = tickets.filter((t) => t.pipelineState === 'staging').length;
  const awaitingCount = tickets.filter((t) => t.pipelineState === 'staging_queued').length;
  const conflictCount = tickets.filter((t) => t.pipelineState === 'conflict').length;
  const inQaCount = onStagingCount;
  const developSha = entry?.develop?.headSha ? entry.develop.headSha.slice(0, 7) : '—';
  const stagingLabel = resetTarget.stagingBranch || 'staging';
  const productionLabel = resetTarget.productionBranch || 'production';

  return (
    <div className={styles.modalScrim} role="presentation" onClick={resetting ? undefined : closeReset}>
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="reset-staging-title"
        onClick={(e) => e.stopPropagation()}
        style={{ borderTop: '3px solid var(--danger)' }}
      >
        <div className={styles.modalHeader} id="reset-staging-title">
          Confirm staging reset
          <div style={{ fontSize: 11, fontWeight: 400, color: 'var(--n-muted)', marginTop: 2 }} className="mono">
            {resetTarget.owner}/{resetTarget.name}
          </div>
        </div>
        <div className={styles.modalBody}>
          <div
            style={{
              padding: '10px 12px',
              borderRadius: 'var(--r-input)',
              background: 'var(--danger-fill)',
              border: '1px solid var(--danger-border)',
              fontSize: 12,
              color: 'var(--n-body)',
              lineHeight: 1.45,
            }}
          >
            This will force-update <span className="mono">{stagingLabel}</span> to{' '}
            <span className="mono">
              {productionLabel}@{developSha}
            </span>
            .
            {typeof ahead === 'number' ? (
              <>
                {' '}
                About <strong>{ahead}</strong> commit{ahead === 1 ? '' : 's'} from tickets already on staging (
                {onStagingCount}) will be discarded
                {conflictCount ? `, including ${conflictCount} conflict${conflictCount === 1 ? '' : 's'}` : ''}.
              </>
            ) : (
              <>
                {' '}
                Tickets already on staging ({onStagingCount}) will be cleared from the sandbox
                {conflictCount ? `, including ${conflictCount} conflict${conflictCount === 1 ? '' : 's'}` : ''}.
              </>
            )}{' '}
            This cannot be undone from Stage2Prod.
          </div>

          {awaitingCount > 0 ? (
            <p style={{ fontSize: 12, color: 'var(--n-muted)', margin: 0 }}>
              {awaitingCount} ticket{awaitingCount === 1 ? '' : 's'} still <em>awaiting merge</em> into staging —
              those open PRs are not discarded by a reset.
            </p>
          ) : null}

          <p style={{ fontSize: 12, color: 'var(--n-muted)', margin: 0 }}>
            If <span className="mono">{stagingLabel}</span> is branch-protected, Stage2Prod will open a reset PR
            instead of force-pushing, and leave ticket state unchanged until that PR is merged (or an admin
            force-pushes).
          </p>

          <label
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 9,
              padding: 11,
              border: '1px solid var(--n-border)',
              borderRadius: 'var(--r-input)',
              cursor: 'pointer',
            }}
          >
            <span
              style={{
                width: 14,
                height: 14,
                flexShrink: 0,
                marginTop: 1,
                borderRadius: 3,
                border: `1px solid ${remergeInQa ? 'var(--brand)' : 'var(--n-border-strong)'}`,
                background: remergeInQa ? 'var(--brand)' : 'var(--n-surface)',
                color: 'var(--brand-on-fill-text)',
                fontSize: 10,
                lineHeight: '12px',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              aria-hidden
            >
              {remergeInQa ? '✓' : ''}
            </span>
            <input type="checkbox" checked={remergeInQa} onChange={toggleRemerge} style={{ display: 'none' }} />
            <span style={{ minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--n-strongest)' }}>
                Re-merge tickets currently in QA
              </span>
              <span style={{ display: 'block', fontSize: 11, color: 'var(--n-muted)', marginTop: 2 }}>
                After a successful force reset, sequentially opens staging PRs for the {inQaCount} feature branch
                {inQaCount === 1 ? '' : 'es'} still marked in QA. Skipped when a reset PR is opened instead.
              </span>
            </span>
          </label>
        </div>
        <div className={styles.modalFooter}>
          <button type="button" className="btn btn-lg btn-plain" onClick={closeReset} disabled={resetting}>
            Cancel
          </button>
          <button type="button" className="btn btn-lg btn-danger" onClick={confirmReset} disabled={resetting}>
            {resetting ? 'Resetting…' : 'Yes, reset staging'}
          </button>
        </div>
      </div>
    </div>
  );
}
