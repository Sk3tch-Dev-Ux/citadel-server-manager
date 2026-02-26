export default function Card({ accent, className, children, ...props }) {
  const classes = [
    'card',
    accent && `card-accent-${accent}`,
    className,
  ].filter(Boolean).join(' ');

  return (
    <div className={classes} {...props}>
      {children}
    </div>
  );
}

export function CardHeader({ children }) {
  return <div className="card-header">{children}</div>;
}

export function CardTitle({ children }) {
  return <div className="card-title">{children}</div>;
}
