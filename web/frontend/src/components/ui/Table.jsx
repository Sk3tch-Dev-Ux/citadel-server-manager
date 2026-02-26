export default function Table({ children }) {
  return (
    <div className="table-wrap">
      <table>{children}</table>
    </div>
  );
}

export function TableHead({ children }) {
  return <thead>{children}</thead>;
}

export function TableBody({ children }) {
  return <tbody>{children}</tbody>;
}

export function TableRow({ children, onClick }) {
  return <tr onClick={onClick} style={onClick ? { cursor: 'pointer' } : undefined}>{children}</tr>;
}

export function TableHeader({ children, ...props }) {
  return <th {...props}>{children}</th>;
}

export function TableCell({ children, ...props }) {
  return <td {...props}>{children}</td>;
}
