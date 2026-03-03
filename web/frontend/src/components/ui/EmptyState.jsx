export default function EmptyState({ icon, title, description, action, children }) {
  return (
    <div className="empty-state">
      {icon && <div className="empty-icon empty-state-icon-large">{icon}</div>}
      {title && <div className="empty-title">{title}</div>}
      {description && <p>{description}</p>}
      {action && <div>{action}</div>}
      {children}
    </div>
  );
}
