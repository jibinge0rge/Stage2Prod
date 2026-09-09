import { StateBadge } from './Badge';
import { pipelineStyle, checkStatusColor } from '../lib/styleMaps';

const COLUMNS = '92px minmax(160px,1.3fr) minmax(140px,1fr) minmax(150px,1.1fr) 128px 148px 66px 84px 74px';

function relativeUpdated(iso) {
  if (!iso) return '—';
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86400)}d ago`;
}

export default function TicketTable({ tickets, selectedKey, onSelect, rowHeight = 34 }) {
  return (
    <div className="card table-wrap">
      <div className="table-head-row" style={{ gridTemplateColumns: COLUMNS, minWidth: 1140 }}>
        <div>Ticket</div>
        <div>Summary</div>
        <div>Repo</div>
        <div>Branch</div>
        <div>Jira status</div>
        <div>Pipeline state</div>
        <div>PR</div>
        <div>Checks</div>
        <div>Updated</div>
      </div>
      {tickets.length === 0 ? (
        <div className="empty-state">No tickets match the current search/filter.</div>
      ) : (
        tickets.map((t) => (
          <div
            key={t.key}
            className={`table-row clickable ${selectedKey === t.key ? 'selected' : ''}`}
            style={{ gridTemplateColumns: COLUMNS, minWidth: 1140, height: rowHeight }}
            onClick={() => onSelect(t.key)}
          >
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--n-strongest)' }}>{t.key}</div>
            <div className="truncate" style={{ fontSize: 12, color: 'var(--n-body)' }}>
              {t.summary}
            </div>
            <div className="mono truncate" style={{ fontSize: 11, color: 'var(--n-muted)' }}>
              {t.repo ? `${t.repo.owner}/${t.repo.name}` : '—'}
            </div>
            <div className="mono truncate" style={{ fontSize: 11, color: 'var(--n-muted)' }}>
              {t.branch || '—'}
            </div>
            <div style={{ fontSize: 11, color: 'var(--n-body)' }}>{t.jiraStatus}</div>
            <div>
              <StateBadge state={t.pipelineState} styleMap={pipelineStyle} />
            </div>
            <div className="mono" style={{ fontSize: 11, color: 'var(--brand)' }}>
              {t.prNumber ? `#${t.prNumber}` : '—'}
            </div>
            <div style={{ fontSize: 11, color: checkStatusColor(t.checkStatus) }}>{t.checkStatus || '—'}</div>
            <div style={{ fontSize: 11, color: 'var(--n-muted)', fontVariantNumeric: 'tabular-nums' }}>
              {relativeUpdated(t.updatedAt)}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
