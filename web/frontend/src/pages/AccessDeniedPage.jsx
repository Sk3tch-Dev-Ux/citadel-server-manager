import { Link } from 'react-router-dom';
import { ShieldOff } from 'lucide-react';

export default function AccessDeniedPage() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', gap: 16, textAlign: 'center', padding: 24 }}>
      <ShieldOff size={64} style={{ color: 'var(--text-muted)', opacity: 0.5 }} />
      <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>Access Denied</h1>
      <p style={{ fontSize: 14, color: 'var(--text-muted)', maxWidth: 400, margin: 0, lineHeight: 1.6 }}>
        You don't have permission to access this page. Contact an administrator if you believe this is an error.
      </p>
      <Link to="/" style={{ marginTop: 8, padding: '10px 20px', background: 'var(--accent-blue)', color: '#fff', borderRadius: 8, textDecoration: 'none', fontSize: 13, fontWeight: 600 }}>
        Back to Dashboard
      </Link>
    </div>
  );
}
