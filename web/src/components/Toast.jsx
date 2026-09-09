import styles from '../layout/AppShell.module.css';

export default function Toast({ message }) {
  return (
    <div className={styles.toast}>
      <span className="dot" style={{ background: 'var(--success)' }} />
      <span>{message}</span>
    </div>
  );
}
