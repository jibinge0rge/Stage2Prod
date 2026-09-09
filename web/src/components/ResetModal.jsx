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

  if (!resetTarget) return null;

  const entry = branches?.repos?.find((r) => r.repo.owner === resetTarget.owner && r.repo.name === resetTarget.name);
  const ahead = entry?.staging?.commitsAheadOfDevelop ?? '—';
  const stagedCount = entry?.staging?.tickets?.length ?? '—';
  const inQaCount = entry?.staging?.tickets?.filter((t) => t.pipelineState === 'staging').length ?? 0;
  const developSha = entry?.develop?.headSha ? entry.develop.headSha.slice(0, 7) : '—';

  return (
    <div className={styles.modalScrim} role="presentation" onClick={closeReset}>
      <div className={styles.modal} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          Reset staging sandbox
          <div style={{ fontSize: 11, fontWeight: 400, color: 'var(--n-muted)', marginTop: 2 }} className="mono">
            {resetTarget.owner}/{resetTarget.name}
          </div>
        </div>
        <div className={styles.modalBody}>
          <p style={{ fontSize: 12, color: 'var(--n-body)', margin: 0 }}>
            <span className="mono">{resetTarget.stagingBranch}</span> will be force-updated to{' '}
            <span className="mono">{resetTarget.productionBranch}</span> at{' '}
            <span className="mono">{developSha}</span>. {ahead} commits from {stagedCount} tickets will be
            discarded. This cannot be undone.
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
                Sequentially merges the {inQaCount} feature branch{inQaCount === 1 ? '' : 'es'} still in QA back
                into the fresh staging branch.
              </span>
            </span>
          </label>
        </div>
        <div className={styles.modalFooter}>
          <button type="button" className="btn btn-lg btn-plain" onClick={closeReset} disabled={resetting}>
            Cancel
          </button>
          <button type="button" className="btn btn-lg btn-danger" onClick={confirmReset} disabled={resetting}>
            {resetting ? 'Resetting…' : 'Reset staging'}
          </button>
        </div>
      </div>
    </div>
  );
}
