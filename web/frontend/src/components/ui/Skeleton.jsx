export default function Skeleton({ width, height = 20, rounded, className }) {
  return (
    <div
      className={`skeleton${className ? ' ' + className : ''}`}
      style={{
        width: width || '100%',
        height,
        borderRadius: rounded ? '50%' : 'var(--radius)',
      }}
    />
  );
}

export function SkeletonRow({ columns = 4 }) {
  return (
    <div style={{ display: 'flex', gap: 16, marginBottom: 12 }}>
      {Array.from({ length: columns }).map((_, i) => (
        <Skeleton key={i} height={16} />
      ))}
    </div>
  );
}

export function SkeletonCard() {
  return (
    <div className="card" style={{ padding: 20 }}>
      <Skeleton width="60%" height={18} />
      <div style={{ marginTop: 12 }} />
      <Skeleton height={14} />
      <div style={{ marginTop: 8 }} />
      <Skeleton width="40%" height={14} />
    </div>
  );
}
