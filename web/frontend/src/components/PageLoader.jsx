export default function PageLoader({ message = 'Loading...' }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 300, gap: 12, color: 'var(--text-muted)' }}>
      <div className="spinner" />
      <span style={{ fontSize: 13 }}>{message}</span>
    </div>
  );
}
