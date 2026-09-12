import styles from './OverviewKpiStrip.module.css';

export default function OverviewKpiStrip({ items }) {
  return (
    <div className={styles.strip} role="list">
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          className={styles.item}
          role="listitem"
          onClick={item.onClick}
        >
          <span className={styles.value} style={item.valueColor ? { color: item.valueColor } : undefined}>
            {item.value}
          </span>
          <span className={styles.label}>{item.label}</span>
        </button>
      ))}
    </div>
  );
}
