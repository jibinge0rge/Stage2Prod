import { useEffect, useState } from 'react';
import styles from '../layout/AppShell.module.css';
import { useAppContext } from '../context/AppContext';
import { getJson, postJson } from '../lib/api';

export default function CutModal() {
  const { cutTarget, closeCutModal, showToast, runPageRefresh, openCut } = useAppContext();
  const [name, setName] = useState('');
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!cutTarget) {
      setPreview(null);
      setName('');
      setError(null);
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    getJson(`/repos/${cutTarget.owner}/${cutTarget.name}/cuts/preview`)
      .then((data) => {
        if (cancelled) return;
        setPreview(data);
        setName(data.suggestedName || '');
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [cutTarget]);

  useEffect(() => {
    if (!cutTarget) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape' && !saving) closeCutModal();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cutTarget, saving, closeCutModal]);

  if (!cutTarget) return null;

  const tickets = preview?.tickets ?? [];
  const stagingLabel = cutTarget.stagingBranch || preview?.repo?.stagingBranch || 'staging';

  async function confirm() {
    setSaving(true);
    setError(null);
    try {
      const result = await postJson(`/repos/${cutTarget.owner}/${cutTarget.name}/cuts`, { name: name.trim() });
      closeCutModal();
      showToast(
        `${cutTarget.owner}/${cutTarget.name}: cut ${result.cut.branchName} from ${stagingLabel} (${result.cut.tickets?.length || 0} tickets).`
      );
      runPageRefresh();
      if (result.cut?.id) {
        openCut({ owner: cutTarget.owner, name: cutTarget.name, id: result.cut.id });
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.modalScrim} role="presentation" onClick={saving ? undefined : closeCutModal}>
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="cut-production-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.modalHeader} id="cut-production-title">
          Cut production from {stagingLabel}
          <div style={{ fontSize: 11, fontWeight: 400, color: 'var(--n-muted)', marginTop: 2 }} className="mono">
            {cutTarget.owner}/{cutTarget.name}
          </div>
        </div>
        <div className={styles.modalBody}>
          <p style={{ fontSize: 12, color: 'var(--n-muted)', margin: 0 }}>
            Creates a new branch at the current {stagingLabel} SHA. The name must include{' '}
            <span className="mono">release</span> (for example <span className="mono">release-4.3.0-v1</span>).
            Tickets listed below are what landed on staging since the last cut.
          </p>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 10, color: 'var(--n-muted)' }}>
            Branch name (must include “release”)
            <input
              className="mono"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={saving || loading}
              style={{
                height: 28,
                padding: '0 8px',
                border: '1px solid var(--n-border)',
                borderRadius: 'var(--r-input)',
                background: 'var(--n-surface)',
                color: 'var(--n-body)',
                fontSize: 12,
              }}
            />
          </label>
          {loading ? (
            <div style={{ fontSize: 12, color: 'var(--n-muted)' }}>Loading changelog…</div>
          ) : preview?.alreadyInSync ? (
            <div style={{ fontSize: 12, color: 'var(--n-muted)' }}>
              Staging is already at the last cut — this cut will point at the same SHA.
            </div>
          ) : (
            <div>
              <div style={{ fontSize: 10, color: 'var(--n-muted)', marginBottom: 6 }}>
                {tickets.length} ticket{tickets.length === 1 ? '' : 's'} from staging
              </div>
              {tickets.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--n-muted)' }}>No tracked tickets in this range.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 180, overflowY: 'auto' }}>
                  {tickets.map((t) => (
                    <div key={t.key} style={{ fontSize: 12, color: 'var(--n-body)' }}>
                      <span style={{ fontWeight: 600 }}>{t.key}</span>
                      {t.summary ? <span style={{ color: 'var(--n-muted)' }}> · {t.summary}</span> : null}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {error ? <div style={{ fontSize: 12, color: 'var(--danger)' }}>{error}</div> : null}
        </div>
        <div className={styles.modalFooter}>
          <button type="button" className="btn btn-lg btn-plain" onClick={closeCutModal} disabled={saving}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-lg btn-primary"
            onClick={confirm}
            disabled={saving || loading || !name.trim()}
          >
            {saving ? 'Cutting…' : 'Create cut'}
          </button>
        </div>
      </div>
    </div>
  );
}
