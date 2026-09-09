export function StateBadge({ state, label, styleMap }) {
  const s = styleMap(state);
  return (
    <span className="badge" style={{ background: s.bg, color: s.fg }}>
      {label ?? s.label}
    </span>
  );
}

export function OutcomeBadge({ outcome, styleMap }) {
  const s = styleMap(outcome);
  return (
    <span className="badge badge-outcome" style={{ background: s.bg, color: s.fg }}>
      {outcome}
    </span>
  );
}
