import { Link } from 'react-router-dom';
import { pipelineStyle } from '../lib/styleMaps';
import { useAppContext } from '../context/AppContext';

function BranchColumn({ label, dotColor, subtitle, tickets, untrackedNote }) {
  return (
    <div style={{ padding: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span className="dot" style={{ width: 8, height: 8, background: dotColor }} />
        <span className="mono" style={{ fontSize: 12, fontWeight: 500, color: 'var(--n-strongest)' }}>
          {label}
        </span>
      </div>
      <div style={{ fontSize: 11, color: 'var(--n-muted)', marginTop: 4 }}>{subtitle}</div>
      {untrackedNote}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12 }}>
        {tickets.length === 0 ? (
          <div style={{ fontSize: 11, color: 'var(--n-muted)' }}>Nothing here right now.</div>
        ) : (
          tickets.map((t) => {
            const s = pipelineStyle(t.pipelineState);
            return (
              <span
                key={t.key}
                className={`pill-row ${s.dashed ? 'dashed' : 'solid'}`}
                style={{ borderColor: s.border, background: s.dashed ? 'transparent' : s.bg, color: s.fg }}
                data-tip={t.summary || undefined}
                aria-label={t.summary ? `${t.key} ${t.summary}` : t.key}
              >
                <span className="pill-row-label">
                  <span className="pill-row-key">{t.key}</span>
                  {t.summary ? <span className="pill-row-summary truncate">{t.summary}</span> : null}
                </span>
                <span className="pill-row-status" style={{ color: s.dashed ? 'var(--n-muted)' : undefined }}>
                  {t.statusLabel}
                </span>
              </span>
            );
          })
        )}
      </div>
    </div>
  );
}

/** One repo's staging/develop board, from one entry of GET /api/branches's `repos` array. */
export default function BranchBoard({ entry, untrackedStagingCount }) {
  const { openReset } = useAppContext();
  const staging = entry?.staging;
  const develop = entry?.develop;
  const repo = entry?.repo;

  return (
    <div className="card">
      <div className="card-header">
        <div className="card-title mono">{repo ? `${repo.owner}/${repo.name}` : 'Branch state'}</div>
        <div className="spacer" />
        <div style={{ fontSize: 11, color: 'var(--n-muted)' }}>no cherry-picks · merge commits only</div>
        {repo && (
          <button type="button" className="btn btn-outline" onClick={() => openReset(repo)}>
            Reset staging
          </button>
        )}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
        <div style={{ borderRight: '1px solid var(--n-hairline)' }}>
          <BranchColumn
            label={repo?.productionBranch ?? 'develop'}
            dotColor="var(--success)"
            subtitle={develop ? `production-ready · head ${develop.headSha ? develop.headSha.slice(0, 7) : '—'}` : 'loading…'}
            tickets={develop?.tickets ?? []}
          />
        </div>
        <BranchColumn
          label={repo?.stagingBranch ?? 'staging'}
          dotColor="var(--brand)"
          subtitle={
            staging
              ? untrackedStagingCount > 0
                ? `${untrackedStagingCount} unvalidated ${
                    untrackedStagingCount === 1 ? 'commit' : 'commits'
                  } ahead · head ${staging.headSha ? staging.headSha.slice(0, 7) : '—'}`
                : `head ${staging.headSha ? staging.headSha.slice(0, 7) : '—'}`
              : 'loading…'
          }
          tickets={staging?.tickets ?? []}
          untrackedNote={
            untrackedStagingCount > 0 && (
              <Link
                to="/untracked"
                style={{ display: 'block', fontSize: 11, color: 'var(--warning)', marginTop: 4 }}
              >
                {untrackedStagingCount} without a ticket →
              </Link>
            )
          }
        />
      </div>
    </div>
  );
}
