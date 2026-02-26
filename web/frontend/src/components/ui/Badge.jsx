export function StatusBadge({ status, children }) {
  return (
    <span className={`status-badge status-${status}`}>
      <span className="status-dot" />
      {children || status}
    </span>
  );
}

export function RoleBadge({ color, children }) {
  return (
    <span className="role-badge" style={{ background: (color || '#8b919a') + '20', color: color || '#8b919a' }}>
      {children}
    </span>
  );
}

export function EventBadge({ event, children }) {
  const eventClass = event?.includes('started') ? 'started'
    : event?.includes('stopped') ? 'stopped'
    : event?.includes('crashed') ? 'crashed'
    : event?.includes('restarted') ? 'restarted'
    : '';

  return (
    <span className={`webhook-event-badge ${eventClass}`}>
      {children}
    </span>
  );
}
