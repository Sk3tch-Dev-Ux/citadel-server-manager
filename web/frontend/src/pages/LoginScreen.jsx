import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import API from '../api';

export default function LoginScreen() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const data = await API.post('/api/auth/login', { username, password });
      if (data.token) {
        login(data.user, data.token);
      } else {
        setError(data.error || 'Login failed');
      }
    } catch {
      setError('Connection failed');
    }
    setLoading(false);
  };

  return (
    <div className="login-screen">
      <form className="login-box" onSubmit={handleSubmit}>
        <div className="sidebar-logo" style={{ justifyContent: 'center', marginBottom: 8 }}>
          <div className="logo-icon">DZ</div>
        </div>
        <div className="login-title">Server Panel</div>
        <div className="login-sub">Sign in to manage your servers</div>
        {error && <div className="login-error">{error}</div>}
        <div className="input-group">
          <label className="input-label">Username</label>
          <input className="input" value={username} onChange={e => setUsername(e.target.value)} autoFocus />
        </div>
        <div className="input-group">
          <label className="input-label">Password</label>
          <input className="input" type="password" value={password} onChange={e => setPassword(e.target.value)} />
        </div>
        <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', marginTop: 8 }} disabled={loading}>
          {loading ? 'Signing in...' : 'Sign In'}
        </button>
      </form>
    </div>
  );
}
